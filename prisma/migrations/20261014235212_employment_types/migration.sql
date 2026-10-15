-- New employment types for employer positions (own migration: Postgres can't use new enum values in the same transaction)
ALTER TYPE "EmploymentType" ADD VALUE 'FULL_TIME';
ALTER TYPE "EmploymentType" ADD VALUE 'PART_TIME';
ALTER TYPE "EmploymentType" ADD VALUE 'SEASONAL';
