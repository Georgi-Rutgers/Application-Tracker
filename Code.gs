/**
 * Google Apps Script backend for the Job Application Tracker sidebar.
 *
 * Before using AI extraction, add the Gemini API key in:
 * Project Settings > Script properties
 *   GEMINI_API_KEY = your API key
 */

var GEMINI_MODEL = 'gemini-3.5-flash';
var GEMINI_API_KEY_PROPERTY = 'GEMINI_API_KEY';
var MAX_FETCHED_TEXT_LENGTH = 50000;
var MAX_AI_TEXT_LENGTH = 30000;

var TRACKER_HEADERS = [
  'Position / Job Title',
  'Company',
  'Industry',
  'Role Type',
  'Location',
  'Platform Applied On',
  'Date Posted',
  'Date Applied',
  'Connections?',
  'Cover Letter',
  'Resume upload?',
  'Resume Form?',
  'Salary Range',
  'Notes',
  'Status',
  'Latest word',
  'contact 1',
  'Link to Posting'
];

/**
 * Adds the tracker menu whenever the spreadsheet opens.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Job Tracker')
    .addItem('Open Tracker Panel', 'showSidebar')
    .addToUi();
}

/**
 * Opens the sidebar UI.
 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Job Application Tracker');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Returns the resume name from the most recently populated Resume upload?
 * cell. An empty string means no resume has been recorded yet.
 */
function getLastUsedResume() {
  var sheet = getActiveSheet_();
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    return '';
  }

  var headers = getHeaderMap_(values[0]);
  if (headers.resumeUpload === undefined) {
    return '';
  }

  for (var row = values.length - 1; row >= 1; row--) {
    var resume = String(values[row][headers.resumeUpload] || '').trim();
    if (resume) {
      return resume;
    }
  }
  return '';
}

function testManual() {
  logApplication({
    applicationType: 'Manual Entry',
    extracted: { jobTitle: 'Test', company: 'Test' }
  });
}


/**
 * Fetches a public job page and returns readable text.
 * The UI can use the returned error to ask the user for pasted raw text.
 */
function fetchPageText(url) {
  validateUrl_(url);

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobApplicationTracker/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    var status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error('The job page returned HTTP ' + status + '.');
    }

    var text = cleanHtmlText_(response.getContentText());
    if (!text) {
      throw new Error('The job page did not contain readable text.');
    }
    return {
      ok: true,
      text: text.substring(0, MAX_FETCHED_TEXT_LENGTH)
    };
  } catch (error) {
    return {
      ok: false,
      error: 'Unable to read that job page. Paste the job description into the raw text box and try again.',
      detail: error.message || String(error)
    };
  }
}

/**
 * Extracts structured application fields with Gemini.
 * The response is normalized so malformed or incomplete AI output cannot
 * corrupt the sheet.
 */
function callGeminiAPI(rawText) {
  if (!rawText || !String(rawText).trim()) {
    throw new Error('Job description text is required for extraction.');
  }

  var apiKey = PropertiesService.getScriptProperties()
    .getProperty(GEMINI_API_KEY_PROPERTY);
  if (!apiKey) {
    throw new Error('The Gemini API key is not configured in Script Properties.');
  }

  // Sanitize key against whitespace or accidental copy-paste artifacts
  apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');

  var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  var prompt = [
    'Extract job application information from the text below.',
    'Return one valid JSON object only: no markdown, code fences, comments, or explanation.',
    'Use exactly these keys: "jobTitle", "company", "industry", "roleType",',
    '"location", "platformAppliedOn", "datePosted", and "salaryRange".',
    'Use "N/A" for missing values. Do not invent facts.',
    '',
    'JOB TEXT:',
    String(rawText).substring(0, MAX_AI_TEXT_LENGTH)
  ].join('\n');

  var response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      })
    });
  } catch (error) {
    throw new Error('Gemini network request failed: ' + (error.message || String(error)));
  }

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status < 200 || status >= 300) {
    Logger.log('Gemini API Error Response (%s): %s', status, body);
    var message = 'Gemini returned HTTP ' + status;
    try {
      var errJson = JSON.parse(body);
      if (errJson.error && errJson.error.message) {
        message += ': ' + errJson.error.message;
      }
    } catch (e) {
      // Body was not JSON
    }
    throw new Error(message);
  }

  try {
    var parsedResponse = JSON.parse(body);
    var generatedText = parsedResponse.candidates[0].content.parts[0].text;
    return normalizeExtraction_(JSON.parse(stripCodeFences_(generatedText)));
  } catch (error) {
    throw new Error('Gemini returned an invalid extraction response.');
  }
}

/**
 * Fetches (when needed), extracts, and logs one application in one server call.
 * This keeps the sheet write atomic from the sidebar's perspective.
 */
function logApplication(formData) {
  formData = formData || {};
  var link = String(formData.link || '').trim();
  var rawText = String(formData.rawText || '').trim();
  var extracted = normalizeExtraction_(formData.extracted || {});

  if (formData.applicationType === 'Manual Entry') {
    if (!hasExtraction_(extracted)) {
      throw new Error('Enter at least a position/title and company for manual entry.');
    }
    return appendApplicationRow({
      jobTitle: extracted.jobTitle,
      company: extracted.company,
      industry: extracted.industry,
      roleType: extracted.roleType,
      location: extracted.location,
      platformAppliedOn: extracted.platformAppliedOn,
      datePosted: extracted.datePosted,
      dateApplied: new Date(),
      coverLetter: formData.coverLetter,
      resumeUpload: formData.resumeUpload,
      resumeForm: formData.resumeForm,
      salaryRange: extracted.salaryRange,
      status: 'Sent',
      link: link
    });
  }

  if (!rawText && !hasExtraction_(extracted)) {
    if (!link) {
      throw new Error('Enter a job link or paste the job description.');
    }
    var fetched = fetchPageText(link);
    if (!fetched.ok) {
      throw new Error(fetched.error);
    }
    rawText = fetched.text;
  }

  if (rawText && !hasExtraction_(extracted)) {
    extracted = callGeminiAPI(rawText);
  }

  return appendApplicationRow({
    jobTitle: extracted.jobTitle,
    company: extracted.company,
    industry: extracted.industry,
    roleType: extracted.roleType,
    location: extracted.location,
    platformAppliedOn: extracted.platformAppliedOn,
    datePosted: extracted.datePosted,
    dateApplied: new Date(),
    coverLetter: formData.coverLetter,
    resumeUpload: formData.resumeUpload,
    resumeForm: formData.resumeForm,
    salaryRange: extracted.salaryRange,
    status: 'Sent',
    link: link
  });
}

/**
 * Appends an application using the sheet's named headers, adding missing
 * tracker columns to the header row when necessary.
 */
function appendApplicationRow(data) {
  var sheet = getActiveSheet_();
  ensureHeaders_(sheet);
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < TRACKER_HEADERS.length) {
    throw new Error('The sheet headers could not be created. Please refresh the sheet and try again.');
  }
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var values = headers.map(function(header) {
    var key = headerKey_(header);
    return data[key] !== undefined ? data[key] : '';
  });
  sheet.appendRow(values);
  return { ok: true, message: 'Application logged successfully.' };
}

function getActiveSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (!sheet) {
    throw new Error('No active sheet is available.');
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, TRACKER_HEADERS.length).setValues([TRACKER_HEADERS]);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  if (existing.every(function(header) { return !String(header).trim(); })) {
    sheet.getRange(1, 1, 1, TRACKER_HEADERS.length).setValues([TRACKER_HEADERS]);
    return;
  }
  var missing = TRACKER_HEADERS.filter(function(header) {
    return existing.map(headerKey_).indexOf(headerKey_(header)) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
}

function getHeaderMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[headerKey_(header)] = index;
  });
  return map;
}

function headerKey_(header) {
  var aliases = {
    'position / job title': 'jobTitle',
    'job title': 'jobTitle',
    'company': 'company',
    'industry': 'industry',
    'role type': 'roleType',
    'location': 'location',
    'platform applied on': 'platformAppliedOn',
    'date posted': 'datePosted',
    'date applied': 'dateApplied',
    'connections?': 'connections',
    'cover letter': 'coverLetter',
    'resume upload?': 'resumeUpload',
    'resume form?': 'resumeForm',
    'salary range': 'salaryRange',
    'notes': 'notes',
    'status': 'status',
    'latest word': 'latestWord',
    'contact 1': 'contact1',
    'link to posting': 'link'
  };
  return aliases[String(header || '').trim().toLowerCase()] || String(header || '').trim();
}

function normalizeExtraction_(data) {
  data = data || {};
  var keys = ['jobTitle', 'company', 'industry', 'roleType', 'location',
    'platformAppliedOn', 'datePosted', 'salaryRange'];
  var result = {};
  keys.forEach(function(key) {
    var value = data[key];
    result[key] = value === undefined || value === null || String(value).trim() === ''
      ? ''
      : String(value).trim();
  });
  return result;
}

function hasExtraction_(data) {
  return data && data.jobTitle && data.jobTitle !== 'N/A' &&
    data.company && data.company !== 'N/A';
}

function validateUrl_(url) {
  if (!/^https?:\/\/\S+$/i.test(String(url || '').trim())) {
    throw new Error('Enter a valid http or https job posting URL.');
  }
}

function cleanHtmlText_(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(Number(code));
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCodeFences_(text) {
  return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/**
 * Handles incoming HTTP POST requests from the sidebar, bypassing google.script.run
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    
    if (payload.action === 'getLastUsedResume') {
      var resume = getLastUsedResume();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, resume: resume }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var result = logApplication(payload.data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      message: err.message || String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
