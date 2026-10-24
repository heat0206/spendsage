-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "paypalPayerId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "monthlyTakeHome" INTEGER NOT NULL,
    "payday" INTEGER NOT NULL DEFAULT 1,
    "savingsFloor" INTEGER NOT NULL,
    "cityTier" TEXT NOT NULL DEFAULT 'tier1',
    "householdSize" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Bills',
    CONSTRAINT "Commitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Festival" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'pan-india',
    "defaultMultiplier" REAL NOT NULL,
    "categoryAffinity" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT
);

-- CreateTable
CREATE TABLE "FestivalSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "festivalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "FestivalSelection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FestivalSelection_festivalId_fkey" FOREIGN KEY ("festivalId") REFERENCES "Festival" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "multiplier" REAL NOT NULL,
    "categoryAffinity" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "CustomEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnualPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "envelope" INTEGER NOT NULL,
    "savingsFloor" INTEGER NOT NULL,
    "aiRationale" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnualPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annualPlanId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "weight" REAL NOT NULL,
    "multiplierBreakdown" TEXT NOT NULL DEFAULT '[]',
    "plannedBudget" INTEGER NOT NULL,
    "overrideAmount" INTEGER,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "carryIn" INTEGER NOT NULL DEFAULT 0,
    "effectiveBudget" INTEGER NOT NULL,
    "actualSpend" INTEGER NOT NULL DEFAULT 0,
    "closedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT "MonthPlan_annualPlanId_fkey" FOREIGN KEY ("annualPlanId") REFERENCES "AnnualPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "monthPlanId" TEXT,
    "amount" INTEGER NOT NULL,
    "merchantRaw" TEXT NOT NULL,
    "merchantClean" TEXT,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "aiConfidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_monthPlanId_fkey" FOREIGN KEY ("monthPlanId") REFERENCES "MonthPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaultDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paypalOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "reason" TEXT NOT NULL DEFAULT 'MANUAL_TOPUP',
    "monthPlanId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_paypalPayerId_key" ON "User"("paypalPayerId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Commitment_userId_idx" ON "Commitment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Festival_name_month_key" ON "Festival"("name", "month");

-- CreateIndex
CREATE INDEX "FestivalSelection_userId_idx" ON "FestivalSelection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FestivalSelection_userId_festivalId_key" ON "FestivalSelection"("userId", "festivalId");

-- CreateIndex
CREATE INDEX "CustomEvent_userId_idx" ON "CustomEvent"("userId");

-- CreateIndex
CREATE INDEX "AnnualPlan_userId_idx" ON "AnnualPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualPlan_userId_year_key" ON "AnnualPlan"("userId", "year");

-- CreateIndex
CREATE INDEX "MonthPlan_annualPlanId_idx" ON "MonthPlan"("annualPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthPlan_annualPlanId_month_key" ON "MonthPlan"("annualPlanId", "month");

-- CreateIndex
CREATE INDEX "Expense_userId_occurredAt_idx" ON "Expense"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDeposit_paypalOrderId_key" ON "VaultDeposit"("paypalOrderId");

-- CreateIndex
CREATE INDEX "VaultDeposit_userId_idx" ON "VaultDeposit"("userId");

-- CreateIndex
CREATE INDEX "Insight_userId_year_month_idx" ON "Insight"("userId", "year", "month");
