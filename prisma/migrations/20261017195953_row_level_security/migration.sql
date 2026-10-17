-- Row-level security: a second isolation layer under tenantDb().
-- tenantDb sets app.org_id (transaction-local) before every query; these policies then only show or accept that
-- company's rows. With no company set (sign-in, webhooks, private-link lookups, migrations) rows are not filtered.
-- FORCE applies the policies to the table owner too; the app's database user must not be a superuser or have BYPASSRLS.

ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invite" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Job" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Candidate" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Application" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Application" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "EeoSelfId" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EeoSelfId" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EeoSelfId" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Client" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Contact" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Deal" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Lead" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vendor" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "TaskComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaskComment" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timesheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Timesheet" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "SignDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SignDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SignDocument" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLine" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "AccountingConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AccountingConnection" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "PayrollConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollConnection" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "PayrollWorker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollWorker" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollWorker" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "VmsProgram" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsProgram" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VmsProgram" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ExternalRef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalRef" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalRef" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ReportSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReportSchedule" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Branch" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Referral" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Referral" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "DoNotReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoNotReturn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DoNotReturn" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "EVerifyCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EVerifyCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EVerifyCase" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "BackgroundCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackgroundCheck" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BackgroundCheck" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "OpenShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpenShift" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OpenShift" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ShiftOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftOffer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShiftOffer" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ClientPortalLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientPortalLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientPortalLink" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "BackgroundTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackgroundTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BackgroundTask" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Activity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Activity" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "StoredFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoredFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StoredFile" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "SalesTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesTarget" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesTarget" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Credential" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Shift" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "WorkerLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkerLink" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollRun" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "PayrollItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollItem" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "PayrollAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollAdjustment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollAdjustment" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEntry" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "OnboardingPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingPackage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OnboardingPackage" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Onboarding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Onboarding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Onboarding" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "OnboardingStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingStep" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OnboardingStep" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Feedback" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "FeedbackRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedbackRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FeedbackRequest" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Recognition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recognition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Recognition" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "TrainingCourse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingCourse" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TrainingCourse" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "TrainingEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingEnrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TrainingEnrollment" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Employee" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "CompensationChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompensationChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompensationChange" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "LeavePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeavePolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeavePolicy" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveRequest" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "LeaveEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveEntry" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ReviewCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewCycle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReviewCycle" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Review" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Goal" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "OffboardingTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OffboardingTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OffboardingTask" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "HiringDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HiringDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HiringDocument" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Interview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Interview" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Scorecard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scorecard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Scorecard" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
