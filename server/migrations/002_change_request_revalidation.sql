-- Change requests remember the schedule they were based on, and why they were closed without a decision.
ALTER TABLE change_requests ADD COLUMN base_hash text;        -- fingerprint of the project's schedule at request time (NULL on legacy rows)
ALTER TABLE change_requests ADD COLUMN closed_reason text;    -- BASE_CHANGED, NEW_CONFLICT, PROJECT_CLOSED, OWNER_CHANGED, REQUESTER_INACTIVE, WITHDRAWN_BY_REQUESTER
ALTER TABLE change_requests ADD COLUMN closed_at timestamptz;

-- At most one pending request per project; the database enforces it, not just the application.
CREATE UNIQUE INDEX change_requests_one_pending_per_project ON change_requests (project_id) WHERE status = 'CHANGE_PENDING';
