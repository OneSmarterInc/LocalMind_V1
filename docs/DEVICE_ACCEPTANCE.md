# Device-first acceptance test

Use a test subject, a faculty account assigned to it, and a student enrolled in
it. Use your own textbook. Keep the central server running. Use separate browser
profiles for faculty and student; changing accounts in one profile is not a
substitute for testing two devices.

Record the tested Git commit, operating system, browser version, local model
filename, RAM, book page count and file size. Repeat on each supported device.
A narrow browser viewport does not establish phone compatibility.

## Faculty: create and share

1. Sign in while connected and install/import the device model in Offline AI.
2. Import a book. Check the extracted text against the original, especially
   equations, headings, figures and tables.
3. Disconnect the browser/device from the server. Keep the application open.
4. Generate a lesson and a quiz. Navigate elsewhere while they run.
5. Reopen them, review every quiz question and refresh the page. Completed work
   must remain available. Record generation durations and content omissions.
6. Approve the content for synchronization while offline. It should show that
   synchronization is waiting.
7. Reconnect without pressing Retry synchronization. Leave the app open.
   Approved work should reach the institution automatically. Check that exactly
   one lesson/draft appears, rather than a duplicate on every reconnect.
8. Complete institutional review/publication. Approval of a local quiz draft
   does not itself mean the quiz is published to students.

## Student: offline use and submission

1. Sign in while connected. Wait until Course sync reports a saved course copy.
   App files should save automatically. Published content must be available to
   this student's enrolled subject.
2. Disconnect, reopen the application, and read the downloaded lesson.
3. Submit a downloaded MCQ quiz and refresh. Revisit it through Subjects and
   Quizzes. Submitted answers must be immutable.
4. Check Overview and Progress: the quiz must no longer be ready to take.
5. For immediate results, verify the local score against the answer key.
   For withheld results, confirm no score or correct answers are visible.
6. Reconnect without manually synchronizing. Confirm exactly one institution
   attempt appears and the local pending event clears.
7. As faculty, release held results. After student synchronization, verify the
   result appears and navigation to Subjects and Quizzes still works.

## Failure and recovery

- Disconnect during synchronization; reconnect and check no duplicate records.
- Restart after completed generation and after quiz submission; check persistence.
- Change the source on another authorized device before synchronizing a draft:
  a conflict should preserve the draft, not silently overwrite newer content.
- Sign out and use another student account: private content must not cross accounts.
- Check the central Monitoring screen separately. Its AI judge remains central;
  device generation does not establish that the central judge model is ready.

## Report

For each failure record:
- Commit and device/browser/model details.
- Book, module, and quiz title.
- Exact steps and whether the server was reachable.
- Screenshot and visible error (exclude passwords/tokens).
- Generation time or time spent waiting for synchronization.

Automated browser acceptance uses a controlled model and a disposable database.
Passing it does not establish real-model quality, speed, actual phone support,
production capacity, or successful extraction for every textbook.
