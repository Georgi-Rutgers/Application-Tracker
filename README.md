# Google Sheets Job Application Tracker

A Google Apps Script sidebar for logging job applications directly to a Google
Sheet. The tracker can fetch a public job posting, use Gemini to extract
structured job details, and append the application to your spreadsheet. It
also supports manual entry when a posting cannot be fetched or parsed.

## Features

- Custom **Job Tracker** menu in Google Sheets.
- Sidebar for autofill or manual application entry.
- Fetches readable text from public job posting URLs.
- Uses Gemini `gemini-2.5-flash` to extract:
  - Position / Job Title
  - Company
  - Industry
  - Role Type
  - Location
  - Platform Applied On
  - Date Posted
  - Salary Range
- Records the current date and time in **Date Applied**.
- Provides a resume-name field for **Resume upload?**.
- Provides a Yes/No field for **Resume Form?**.
- Defaults **Status** to `Sent`.
- Preserves unspecified fields such as Connections?, Notes, Latest word, and
  contact 1 as blank.
- Provides a raw-text fallback for pages blocked by anti-bot protection.

## Requirements

- A Google account.
- A Google Sheet.
- Access to Google Apps Script.
- A Gemini API key.

The Gemini API has usage limits and may require billing depending on Google's
current terms, account, model availability, and usage. Review the current
Google AI Studio and Gemini API documentation before using it at scale.

## Spreadsheet setup

1. Create or open a Google Sheet.
2. Put the following headers in **row 1**, one header per column, in this
   order:

   ```text
   Position / Job Title
   Company
   Industry
   Role Type
   Location
   Platform Applied On
   Date Posted
   Date Applied
   Connections?
   Cover Letter
   Resume upload?
   Resume Form?
   Salary Range
   Notes
   Status
   Latest word
   contact 1
   Link to Posting
   ```

The script matches columns by header name, so the order can be changed after
setup. Use the unaccented header names shown above. The **Resume upload?**
column stores the name of the resume used, while **Resume Form?** records
whether the application form used resume-based autofill.

If the sheet is blank, the script can create the expected headers when the
first application is logged. Creating the header row yourself is recommended
so the sheet is easy to inspect before the first use.

## Add the script to Google Sheets

1. Open the target spreadsheet.
2. Select **Extensions → Apps Script**.
3. In the Apps Script editor, replace the contents of `Code.gs` with the
   contents of [`Code.gs`](./Code.gs).
4. Click **+ → HTML** to create an HTML file.
5. Name the file exactly `Sidebar`.
6. Replace its contents with [`Sidebar.html`](./Sidebar.html).
7. Click **Save**.

The Apps Script project must be bound to the spreadsheet that should receive
the application records. Do not create a standalone Apps Script project unless
you update the spreadsheet access logic yourself.

## Get a Gemini API key

1. Open [Google AI Studio API keys](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account.
3. Select **Create API key**.
4. Choose an existing Google Cloud project or create a new one if prompted.
5. Copy the generated key.

Treat the key like a password. Do not commit it to GitHub, put it in
`Code.gs`, or paste it into `Sidebar.html`.

## Add the API key to Apps Script

1. In the Apps Script editor for the spreadsheet, open **Project Settings**
   using the gear icon.
2. Find **Script Properties**.
3. Click **Add script property**.
4. Set the property name exactly to:

   ```text
   GEMINI_API_KEY
   ```

5. Paste the Gemini API key as the property value.
6. Save the property.

The backend reads the key using
`PropertiesService.getScriptProperties()`. The key is never sent to the
sidebar or written to the spreadsheet.

## Authorize and open the tracker

1. Return to the spreadsheet and refresh the page.
2. Open the **Job Tracker** menu.
3. Select **Open Tracker Panel**.
4. The first time you use the script, Google will ask you to authorize access
   to the spreadsheet and external services. Review the requested permissions
   and authorize the script.

If the menu does not appear, refresh the spreadsheet again. You can also run
the `onOpen` function once from the Apps Script editor, then return to the
spreadsheet.

## Using the sidebar

### Autofill Form

1. Enter the public job posting URL.
2. Enter the name of the resume used, or click **Use Last** to reuse the most
   recently recorded resume. Select the Yes/No values for the cover letter and
   Resume Form? questions.
3. Click **Log Application**.
4. The script fetches the page and sends the readable job text to Gemini.
5. Extracted values are written to the matching spreadsheet columns.

If the posting is blocked or cannot be read, paste the job description into
**Raw job description** and submit again. The raw text is used for extraction
without requiring the page fetch to succeed.

### Manual Entry

1. Select **Manual Entry**.
2. Enter the available job details and the name of the resume used.
3. Select the Yes/No application details.
4. Click **Log Application**.

Manual Entry does not call Gemini. Missing fields are left blank.

For both modes:

- **Date Applied** is set automatically by the server when the row is written.
- **Status** is set to `Sent`.
- **Link to Posting** receives the URL entered in the sidebar.
- The script does not guess values for Connections?, Notes, Latest word, or
  contact 1.

## Troubleshooting

### "The Gemini API key is not configured"

Confirm that the key is stored as a **Script Property** named exactly
`GEMINI_API_KEY`, not as a user property or a value in the source code.

### The Job Tracker menu is missing

Refresh the spreadsheet. If it is still missing, open Apps Script and run
`onOpen` once, authorize the project, then refresh the spreadsheet again.

### The job page cannot be fetched

Some job boards require JavaScript, authentication, or block automated
requests. Paste the visible job description into the raw-text fallback area.

### A column is not being populated

Check that the header in row 1 matches one of the supported names exactly.
In particular, preserve the question marks in `Resume upload?` and
`Resume Form?`. Missing expected headers are created automatically when the
first application is logged.

### Gemini returns incomplete information

AI extraction depends on the text available from the job page. Use Manual
Entry for corrections, or provide a more complete job description in the
raw-text fallback.

## Privacy and security

- Job descriptions and URLs entered in Autofill mode are sent to the Gemini
  API for extraction.
- Keep your API key in Apps Script Script Properties.
- Do not commit API keys or other credentials to this repository.
- Restrict access to the spreadsheet and Apps Script project to people who
  should be able to view the application data.
- Revoke or rotate the API key from Google AI Studio if it is exposed.

## Project files

- [`Code.gs`](./Code.gs) — spreadsheet menu, page fetching, Gemini integration,
  extraction normalization, and row logging.
- [`Sidebar.html`](./Sidebar.html) — the sidebar form and client-side
  interaction.
