-- CreateEnum
CREATE TYPE "TopicSource" AS ENUM ('GOOGLE_TRENDS', 'REDDIT', 'HACKER_NEWS', 'MANUAL');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'USED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('QUEUED', 'SCRIPTING', 'VOICING', 'FETCHING_ASSETS', 'RENDERING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" "TopicSource" NOT NULL,
    "sourceUrl" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "TopicStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT,
    "scriptText" TEXT,
    "visualKeywords" TEXT[],
    "audioPath" TEXT,
    "audioDurationSec" DOUBLE PRECISION,
    "subtitlePath" TEXT,
    "videoPath" TEXT,
    "failedStage" "VideoStatus",
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineLog" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "stage" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Topic_status_score_idx" ON "Topic"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_title_source_key" ON "Topic"("title", "source");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");

-- CreateIndex
CREATE INDEX "PipelineLog_videoId_idx" ON "PipelineLog"("videoId");

-- CreateIndex
CREATE INDEX "PipelineLog_createdAt_idx" ON "PipelineLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
