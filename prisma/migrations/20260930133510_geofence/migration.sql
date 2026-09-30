-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "geofenceMeters" INTEGER,
ADD COLUMN     "siteLat" DOUBLE PRECISION,
ADD COLUMN     "siteLng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "geofenceMode" TEXT NOT NULL DEFAULT 'flag';

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "inDistanceM" INTEGER,
ADD COLUMN     "offSite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outDistanceM" INTEGER;
