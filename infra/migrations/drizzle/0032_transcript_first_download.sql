-- The first learner download a video gets is shared at once. Its row stays, emptied, as the record of who supplied the transcript.
CREATE POLICY transcript_submissions_worker_update ON catalog.transcript_submissions FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
GRANT UPDATE (segments) ON catalog.transcript_submissions TO learnspace_worker;
