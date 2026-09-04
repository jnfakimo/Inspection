-- InspectionV2 local operational empty-table migration
-- Migration id: 2026-08-31.local-operational-empty-tables.v1
--
-- Purpose
--   * Preserve [supabase_import] as immutable staging/provenance data.
--   * Recreate the eight source-empty business tables as typed SQL Server tables
--     under [app].
--   * Keep all writes denied to the IIS identity until the application workflows
--     and transactional stored procedures have been ported and approved.
--
-- Safe execution
--   Use scripts/apply-local-operational-schema.ps1. Its default is DryRun, which
--   supplies MigrationMode=ROLLBACK. A real commit requires the explicit -Commit
--   switch and a separate approval.
--
-- Rollback after a committed run
--   This migration intentionally grants no application writes, so the eight
--   tables should remain empty until a later workflow migration. Before dropping
--   anything, verify every [app] target table is still empty, take/verify a FULL
--   backup, and obtain the data owner's approval. Drop in reverse dependency order
--   (records, plans, contracts, documents, annual costs, monitor events, materials,
--   meeting changes), remove this migration's history row, and keep the [app]
--   schema if it contains any other object. Never drop [supabase_import].

:on error exit

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @MigrationId nvarchar(128) = N'2026-08-31.local-operational-empty-tables.v1';
DECLARE @MigrationMode nvarchar(16) = UPPER(LTRIM(RTRIM(N'$(MigrationMode)')));
DECLARE @ScriptSha256 char(64) = LOWER(LTRIM(RTRIM('$(ScriptSha256)')));
DECLARE @SourceManifestSha256 char(64) = LOWER(LTRIM(RTRIM('$(SourceManifestSha256)')));
DECLARE @ApprovalReference nvarchar(128) = LTRIM(RTRIM(N'$(ApprovalReference)'));
DECLARE @EmptyPayloadSha256 char(64) = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
DECLARE @NetTransport nvarchar(40) = (
    SELECT net_transport FROM sys.dm_exec_connections WHERE session_id = @@SPID
);
DECLARE @FullBackupSetId int = NULL, @LogBackupSetId int = NULL;
DECLARE @FullFinishedAt datetime = NULL, @LogFinishedAt datetime = NULL;
DECLARE @FullBackupPath nvarchar(4000) = NULL, @LogBackupPath nvarchar(4000) = NULL;
DECLARE @LogJobAction nvarchar(40) = N'NOT_REQUIRED_FOR_DRYRUN';

IF @MigrationMode NOT IN (N'ROLLBACK', N'COMMIT')
    THROW 51000, N'MigrationMode must be ROLLBACK or COMMIT.', 1;
IF LEN(@ScriptSha256) <> 64 OR @ScriptSha256 LIKE '%[^0-9a-f]%'
    THROW 51001, N'ScriptSha256 must be a lowercase SHA-256 hex digest.', 1;
IF LEN(@SourceManifestSha256) <> 64 OR @SourceManifestSha256 LIKE '%[^0-9a-f]%'
    THROW 51002, N'SourceManifestSha256 must be a lowercase SHA-256 hex digest.', 1;
IF LEN(@ApprovalReference) NOT BETWEEN 3 AND 128
   OR @ApprovalReference LIKE N'%[^A-Za-z0-9._:/#-]%'
    THROW 51003, N'ApprovalReference has an invalid length or character.', 1;
IF @MigrationMode = N'COMMIT' AND @ApprovalReference = N'DRYRUN-NO-COMMIT'
    THROW 51004, N'Commit requires an approved change/ticket reference.', 1;
IF @NetTransport <> N'Shared memory'
    THROW 51005, N'This migration requires a local Shared Memory/LPC SQL connection.', 1;
IF CONVERT(int, SERVERPROPERTY('ProductMajorVersion')) < 16
    THROW 51006, N'SQL Server 2022 or later is required for typed ISJSON constraints.', 1;
IF (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) < 160
    THROW 51007, N'Database compatibility level 160 or later is required.', 1;
IF SUSER_ID(N'NT AUTHORITY\LOCAL SERVICE') IS NULL
    THROW 51008, N'The NT AUTHORITY\LOCAL SERVICE SQL login is missing.', 1;
IF IS_SRVROLEMEMBER(N'sysadmin', N'NT AUTHORITY\LOCAL SERVICE') = 1
    THROW 51009, N'LOCAL SERVICE must not be sysadmin; DENY would be ineffective.', 1;

DECLARE @ExpectedTarget table (
    ordinal int NOT NULL PRIMARY KEY,
    table_name sysname NOT NULL UNIQUE,
    canonical_source nvarchar(260) NOT NULL,
    expected_columns int NOT NULL
);

INSERT @ExpectedTarget(ordinal, table_name, canonical_source, expected_columns)
VALUES
    (1, N'equipment_contracts', N'system/sql/equipment_lifecycle.sql:135-167', 18),
    (2, N'equipment_maintenance_plans', N'system/sql/equipment_lifecycle.sql:73-101', 22),
    (3, N'equipment_maintenance_records', N'system/sql/equipment_lifecycle.sql:104-132', 21),
    (4, N'equipment_documents', N'system/sql/equipment_lifecycle.sql:170-193', 14),
    (5, N'equipment_annual_costs', N'system/sql/equipment_lifecycle.sql:196-212', 13),
    (6, N'equipment_monitor_events', N'system/sql/equipment_lifecycle.sql:270-294', 18),
    (7, N'materials', N'system/sql/material_master.sql:28-78', 69),
    (8, N'meeting_booking_change_requests', N'supabase/migrations/20260805143000_meeting_booking_change_requests.sql:8-40', 13);

BEGIN TRY
    ---------------------------------------------------------------------------
    -- Commit-only recovery gate. DryRun never starts backup jobs or reads files.
    ---------------------------------------------------------------------------
    IF @MigrationMode = N'COMMIT'
    BEGIN
        DECLARE @LogJobName sysname = N'TAIPECMKT-InspectionV2-LogBackup';
        DECLARE @LogJobId uniqueidentifier;
        DECLARE @LatestLogJobSuccess datetime = NULL;
        DECLARE @JobGateStartedAt datetime = GETDATE();
        DECLARE @JobDeadline datetime = DATEADD(second, 120, GETDATE());

        SELECT @LogJobId = job_id
        FROM msdb.dbo.sysjobs
        WHERE name = @LogJobName AND enabled = 1;
        IF @LogJobId IS NULL
            THROW 51050, N'Required enabled InspectionV2 log-backup SQL Agent job was not found.', 1;

        SELECT TOP (1) @LatestLogJobSuccess = msdb.dbo.agent_datetime(h.run_date, h.run_time)
        FROM msdb.dbo.sysjobhistory h
        WHERE h.job_id = @LogJobId AND h.step_id = 0 AND h.run_status = 1
        ORDER BY h.instance_id DESC;

        IF @LatestLogJobSuccess >= DATEADD(minute, -30, GETDATE())
            SET @LogJobAction = N'CONFIRMED_RECENT_SUCCESS';
        ELSE
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM msdb.dbo.sysjobactivity a
                WHERE a.job_id = @LogJobId
                  AND a.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
                  AND a.start_execution_date IS NOT NULL
                  AND a.stop_execution_date IS NULL
            )
            BEGIN
                EXEC msdb.dbo.sp_start_job @job_id = @LogJobId;
                SET @LogJobAction = N'STARTED_AND_VERIFIED';
            END
            ELSE
                SET @LogJobAction = N'WAITED_FOR_RUNNING_JOB';

            WHILE GETDATE() < @JobDeadline
            BEGIN
                SELECT TOP (1) @LatestLogJobSuccess = msdb.dbo.agent_datetime(h.run_date, h.run_time)
                FROM msdb.dbo.sysjobhistory h
                WHERE h.job_id = @LogJobId AND h.step_id = 0 AND h.run_status = 1
                ORDER BY h.instance_id DESC;
                IF @LatestLogJobSuccess >= @JobGateStartedAt BREAK;
                WAITFOR DELAY '00:00:05';
            END;
            IF @LatestLogJobSuccess < @JobGateStartedAt OR @LatestLogJobSuccess IS NULL
                THROW 51051, N'Log-backup job did not complete successfully within the recovery gate timeout.', 1;
        END;

        SELECT TOP (1)
            @FullBackupSetId = bs.backup_set_id,
            @FullFinishedAt = bs.backup_finish_date
        FROM msdb.dbo.backupset bs
        WHERE bs.database_name = DB_NAME()
          AND bs.type = N'D'
          AND bs.is_copy_only = 0
          AND bs.has_backup_checksums = 1
          AND bs.key_algorithm = N'AES_256'
          AND bs.encryptor_thumbprint IS NOT NULL
          AND bs.backup_finish_date >= DATEADD(hour, -24, GETDATE())
        ORDER BY bs.backup_finish_date DESC;

        SELECT TOP (1)
            @LogBackupSetId = bs.backup_set_id,
            @LogFinishedAt = bs.backup_finish_date
        FROM msdb.dbo.backupset bs
        WHERE bs.database_name = DB_NAME()
          AND bs.type = N'L'
          AND bs.has_backup_checksums = 1
          AND bs.key_algorithm = N'AES_256'
          AND bs.encryptor_thumbprint IS NOT NULL
          AND bs.backup_finish_date >= DATEADD(minute, -30, GETDATE())
        ORDER BY bs.backup_finish_date DESC;

        IF @FullBackupSetId IS NULL OR @LogBackupSetId IS NULL
            THROW 51052, N'Recent AES_256 encrypted CHECKSUM FULL and LOG backups are required before Commit.', 1;
        IF (SELECT COUNT(*) FROM msdb.dbo.backupmediafamily WHERE media_set_id = (SELECT media_set_id FROM msdb.dbo.backupset WHERE backup_set_id = @FullBackupSetId)) <> 1
           OR (SELECT COUNT(*) FROM msdb.dbo.backupmediafamily WHERE media_set_id = (SELECT media_set_id FROM msdb.dbo.backupset WHERE backup_set_id = @LogBackupSetId)) <> 1
            THROW 51053, N'The pre-Commit verifier currently requires one DISK media family per backup set.', 1;

        SELECT @FullBackupPath = bmf.physical_device_name
        FROM msdb.dbo.backupset bs
        JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bs.media_set_id
        WHERE bs.backup_set_id = @FullBackupSetId AND bmf.device_type = 2;
        SELECT @LogBackupPath = bmf.physical_device_name
        FROM msdb.dbo.backupset bs
        JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bs.media_set_id
        WHERE bs.backup_set_id = @LogBackupSetId AND bmf.device_type = 2;
        IF @FullBackupPath IS NULL OR @LogBackupPath IS NULL
            THROW 51054, N'Backup media is not an accessible DISK device.', 1;

        RESTORE VERIFYONLY FROM DISK = @FullBackupPath WITH CHECKSUM;
        RESTORE VERIFYONLY FROM DISK = @LogBackupPath WITH CHECKSUM;
        PRINT CONCAT(
            N'BACKUP_EVIDENCE|VERIFIED|', @FullBackupSetId, N'|',
            CONVERT(nvarchar(30), @FullFinishedAt, 126), N'|', @LogBackupSetId, N'|',
            CONVERT(nvarchar(30), @LogFinishedAt, 126), N'|', @LogJobAction
        );
    END;

    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    BEGIN TRANSACTION;

    ---------------------------------------------------------------------------
    -- Source preflight: all eight staging tables must still be source-empty
    -- shells with exactly the two importer metadata columns.
    ---------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM @ExpectedTarget e
        WHERE OBJECT_ID(QUOTENAME(N'supabase_import') + N'.' + QUOTENAME(e.table_name), N'U') IS NULL
    )
        THROW 51010, N'One or more required supabase_import staging tables are missing.', 1;

    IF EXISTS (
        SELECT 1
        FROM @ExpectedTarget e
        CROSS APPLY (
            SELECT COUNT(*) AS column_count
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID(QUOTENAME(N'supabase_import') + N'.' + QUOTENAME(e.table_name), N'U')
        ) x
        WHERE x.column_count <> 2
    )
        THROW 51011, N'A source-empty staging table has columns other than the two importer metadata columns.', 1;

    IF EXISTS (
        SELECT 1
        FROM @ExpectedTarget e
        JOIN sys.columns c
          ON c.object_id = OBJECT_ID(QUOTENAME(N'supabase_import') + N'.' + QUOTENAME(e.table_name), N'U')
        WHERE c.name NOT IN (N'_migration_row_no', N'_source_json')
    )
        THROW 51012, N'Unexpected business column found in a source-empty staging table.', 1;

    IF EXISTS (
        SELECT 1
        FROM @ExpectedTarget e
        WHERE NOT EXISTS (
                  SELECT 1
                  FROM sys.columns c
                  WHERE c.object_id = OBJECT_ID(QUOTENAME(N'supabase_import') + N'.' + QUOTENAME(e.table_name), N'U')
                    AND c.name = N'_migration_row_no'
                    AND TYPE_NAME(c.user_type_id) = N'bigint'
                    AND c.max_length = 8
                    AND c.is_nullable = 0
              )
           OR NOT EXISTS (
                  SELECT 1
                  FROM sys.columns c
                  WHERE c.object_id = OBJECT_ID(QUOTENAME(N'supabase_import') + N'.' + QUOTENAME(e.table_name), N'U')
                    AND c.name = N'_source_json'
                    AND TYPE_NAME(c.user_type_id) = N'nvarchar'
                    AND c.max_length = -1
                    AND c.is_nullable = 0
              )
    )
        THROW 51013, N'Staging metadata column type or nullability has drifted.', 1;

    CREATE TABLE #StagingManifest (
        table_name sysname NOT NULL PRIMARY KEY,
        source_rows bigint NOT NULL,
        staging_columns int NOT NULL,
        source_payload_sha256 char(64) NOT NULL
    );

    INSERT #StagingManifest(table_name, source_rows, staging_columns, source_payload_sha256)
    SELECT N'equipment_maintenance_plans', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_maintenance_plans WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'equipment_maintenance_records', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_maintenance_records WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'equipment_contracts', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_contracts WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'equipment_documents', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_documents WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'equipment_annual_costs', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_annual_costs WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'equipment_monitor_events', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.equipment_monitor_events WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'materials', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.materials WITH (HOLDLOCK, TABLOCKX)
    UNION ALL SELECT N'meeting_booking_change_requests', COUNT_BIG(*), 2, @EmptyPayloadSha256
      FROM supabase_import.meeting_booking_change_requests WITH (HOLDLOCK, TABLOCKX);

    IF EXISTS (SELECT 1 FROM #StagingManifest WHERE source_rows <> 0)
        THROW 51014, N'A staging table is no longer empty. Stop and design a data-preserving migration.', 1;

    ---------------------------------------------------------------------------
    -- Target preflight and migration history.
    ---------------------------------------------------------------------------
    IF SCHEMA_ID(N'app') IS NULL
        EXEC(N'CREATE SCHEMA [app] AUTHORIZATION [dbo];');

    IF OBJECT_ID(N'app.schema_migration_history', N'U') IS NULL
    BEGIN
        CREATE TABLE app.schema_migration_history (
            migration_id nvarchar(128) NOT NULL,
            script_sha256 char(64) NOT NULL,
            source_manifest_sha256 char(64) NOT NULL,
            source_schema sysname NOT NULL,
            target_schema sysname NOT NULL,
            table_count int NOT NULL,
            source_row_count bigint NOT NULL,
            status nvarchar(16) NOT NULL,
            first_applied_at datetimeoffset(3) NOT NULL,
            last_verified_at datetimeoffset(3) NOT NULL,
            applied_by sysname NOT NULL,
            approval_reference nvarchar(128) NOT NULL,
            CONSTRAINT PK_app_schema_migration_history PRIMARY KEY CLUSTERED (migration_id),
            CONSTRAINT CK_app_schema_migration_history_status CHECK (status IN (N'validated', N'committed')),
            CONSTRAINT CK_app_schema_migration_history_table_count CHECK (table_count > 0),
            CONSTRAINT CK_app_schema_migration_history_source_rows CHECK (source_row_count >= 0)
        );
    END;

    DECLARE @ExistingTargetCount int = (
        SELECT COUNT(*)
        FROM @ExpectedTarget e
        JOIN sys.tables t ON t.name = e.table_name
        JOIN sys.schemas s ON s.schema_id = t.schema_id AND s.name = N'app'
    );
    DECLARE @PreviouslyApplied bit = 0;

    IF @ExistingTargetCount NOT IN (0, 8)
        THROW 51020, N'Partial app target schema detected; refusing to guess or overwrite.', 1;

    IF @ExistingTargetCount = 0
       AND EXISTS (SELECT 1 FROM app.schema_migration_history WHERE migration_id = @MigrationId)
        THROW 51021, N'Migration history exists but the eight target tables do not.', 1;

    IF @ExistingTargetCount = 8
    BEGIN
        SET @PreviouslyApplied = 1;
        IF NOT EXISTS (
            SELECT 1
            FROM app.schema_migration_history
            WHERE migration_id = @MigrationId
              AND script_sha256 = @ScriptSha256
              AND source_manifest_sha256 = @SourceManifestSha256
              AND status = N'committed'
        )
            THROW 51022, N'Existing target tables do not match this committed migration manifest.', 1;

        IF EXISTS (
            SELECT 1
            FROM @ExpectedTarget e
            JOIN sys.tables t ON t.name = e.table_name
            JOIN sys.schemas s ON s.schema_id = t.schema_id AND s.name = N'app'
            LEFT JOIN sys.extended_properties ep
              ON ep.major_id = t.object_id
             AND ep.minor_id = 0
             AND ep.name = N'InspectionMigrationId'
            WHERE ep.value IS NULL OR CONVERT(nvarchar(128), ep.value) <> @MigrationId
        )
            THROW 51023, N'Existing target table provenance property is missing or mismatched.', 1;
    END;

    ---------------------------------------------------------------------------
    -- Eight typed operational tables. Parent FKs to imported business tables
    -- are deliberately deferred until typed parent keys exist. The two safe
    -- in-schema dependencies (plan -> contract and record -> plan) are enforced.
    ---------------------------------------------------------------------------
    IF OBJECT_ID(N'app.equipment_contracts', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_contracts (
            contract_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_contracts_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            vendor nvarchar(200) NOT NULL,
            contact_name nvarchar(150) NULL,
            contact_phone nvarchar(50) NULL,
            contract_no nvarchar(100) NULL,
            starts_on date NULL,
            ends_on date NULL,
            service_scope nvarchar(2000) NULL,
            sla_hours decimal(10,2) NULL,
            contract_amount decimal(14,2) NULL,
            status nvarchar(20) NOT NULL CONSTRAINT DF_app_equipment_contracts_status DEFAULT N'active',
            import_key nvarchar(450) NULL,
            note nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_contracts_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            updated_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_contracts_updated DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            created_by uniqueidentifier NULL,
            updated_by uniqueidentifier NULL,
            CONSTRAINT PK_app_equipment_contracts PRIMARY KEY CLUSTERED (contract_id),
            CONSTRAINT CK_app_equipment_contracts_status CHECK (status IN (N'draft',N'active',N'expired',N'terminated',N'inactive'))
        );
    END;

    IF OBJECT_ID(N'app.equipment_maintenance_plans', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_maintenance_plans (
            plan_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            item_name nvarchar(200) NOT NULL,
            maintenance_type nvarchar(32) NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_type DEFAULT N'preventive',
            cycle_text nvarchar(200) NULL,
            interval_value decimal(12,2) NULL,
            interval_unit nvarchar(16) NULL,
            responsible_user_id uniqueidentifier NULL,
            responsible_name nvarchar(150) NULL,
            contract_id uniqueidentifier NULL,
            checklist_template nvarchar(max) NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_checklist DEFAULT N'[]',
            trigger_point_code nvarchar(100) NULL,
            last_performed_on date NULL,
            next_due_on date NULL,
            last_completed_on date NULL,
            last_result nvarchar(500) NULL,
            status nvarchar(20) NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_status DEFAULT N'active',
            note nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            updated_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_maintenance_plans_updated DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            created_by uniqueidentifier NULL,
            updated_by uniqueidentifier NULL,
            CONSTRAINT PK_app_equipment_maintenance_plans PRIMARY KEY CLUSTERED (plan_id),
            CONSTRAINT FK_app_equipment_maintenance_plans_contract FOREIGN KEY (contract_id) REFERENCES app.equipment_contracts(contract_id),
            CONSTRAINT CK_app_equipment_maintenance_plans_type CHECK (maintenance_type IN (N'preventive',N'predictive',N'statutory',N'condition_based',N'other')),
            CONSTRAINT CK_app_equipment_maintenance_plans_unit CHECK (interval_unit IS NULL OR interval_unit IN (N'day',N'week',N'month',N'year',N'hour',N'count')),
            CONSTRAINT CK_app_equipment_maintenance_plans_status CHECK (status IN (N'active',N'paused',N'inactive')),
            CONSTRAINT CK_app_equipment_maintenance_plans_checklist CHECK (ISJSON(checklist_template, ARRAY) = 1)
        );
    END;

    IF OBJECT_ID(N'app.equipment_maintenance_records', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_maintenance_records (
            record_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            plan_id uniqueidentifier NULL,
            source_order_id uniqueidentifier NULL,
            record_type nvarchar(32) NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_type DEFAULT N'maintenance',
            performed_on date NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_date DEFAULT CONVERT(date, SYSDATETIMEOFFSET() AT TIME ZONE 'Taipei Standard Time'),
            fault_description nvarchar(2000) NULL,
            fault_cause nvarchar(2000) NULL,
            action_taken nvarchar(2000) NULL,
            replacement_parts nvarchar(1000) NULL,
            downtime_hours decimal(12,2) NULL,
            technician nvarchar(150) NULL,
            result nvarchar(500) NULL,
            maintenance_cost decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_maintenance_cost DEFAULT 0,
            parts_cost decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_parts_cost DEFAULT 0,
            downtime_loss decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_downtime_loss DEFAULT 0,
            next_due_on date NULL,
            import_key nvarchar(450) NULL,
            note nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_maintenance_records_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            created_by uniqueidentifier NULL,
            CONSTRAINT PK_app_equipment_maintenance_records PRIMARY KEY CLUSTERED (record_id),
            CONSTRAINT FK_app_equipment_maintenance_records_plan FOREIGN KEY (plan_id) REFERENCES app.equipment_maintenance_plans(plan_id),
            CONSTRAINT CK_app_equipment_maintenance_records_type CHECK (record_type IN (N'maintenance',N'repair',N'inspection_followup',N'overhaul',N'replacement',N'other'))
        );
    END;

    IF OBJECT_ID(N'app.equipment_documents', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_documents (
            document_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_documents_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            document_type nvarchar(50) NOT NULL,
            title nvarchar(300) NOT NULL,
            file_url nvarchar(2048) NOT NULL,
            version nvarchar(100) NULL,
            checksum nvarchar(128) NULL,
            effective_on date NULL,
            expires_on date NULL,
            is_current bit NOT NULL CONSTRAINT DF_app_equipment_documents_current DEFAULT 1,
            import_key nvarchar(450) NULL,
            note nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_documents_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            uploaded_by uniqueidentifier NULL,
            CONSTRAINT PK_app_equipment_documents PRIMARY KEY CLUSTERED (document_id),
            CONSTRAINT CK_app_equipment_documents_type CHECK (document_type IN (N'operation_manual',N'maintenance_manual',N'parts_manual',N'circuit_diagram',N'plc_program',N'parameter_backup',N'photo',N'certificate',N'contract',N'other'))
        );
    END;

    IF OBJECT_ID(N'app.equipment_annual_costs', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_annual_costs (
            annual_cost_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_annual_costs_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            fiscal_year int NOT NULL,
            repair_cost decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_repair DEFAULT 0,
            maintenance_cost decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_maintenance DEFAULT 0,
            parts_cost decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_parts DEFAULT 0,
            downtime_loss decimal(14,2) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_downtime DEFAULT 0,
            source nvarchar(20) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_source DEFAULT N'import',
            note nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            updated_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_annual_costs_updated DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            created_by uniqueidentifier NULL,
            updated_by uniqueidentifier NULL,
            CONSTRAINT PK_app_equipment_annual_costs PRIMARY KEY CLUSTERED (annual_cost_id),
            CONSTRAINT UQ_app_equipment_annual_costs UNIQUE (equipment_id, fiscal_year, source),
            CONSTRAINT CK_app_equipment_annual_costs_year CHECK (fiscal_year BETWEEN 2000 AND 2200),
            CONSTRAINT CK_app_equipment_annual_costs_source CHECK (source IN (N'import',N'manual',N'calculated'))
        );
    END;

    IF OBJECT_ID(N'app.equipment_monitor_events', N'U') IS NULL
    BEGIN
        CREATE TABLE app.equipment_monitor_events (
            event_id uniqueidentifier NOT NULL CONSTRAINT DF_app_equipment_monitor_events_id DEFAULT NEWSEQUENTIALID(),
            equipment_id uniqueidentifier NOT NULL,
            point_id uniqueidentifier NULL,
            external_system nvarchar(100) NULL,
            external_event_key nvarchar(300) NULL,
            event_code nvarchar(100) NULL,
            severity nvarchar(20) NOT NULL CONSTRAINT DF_app_equipment_monitor_events_severity DEFAULT N'info',
            event_state nvarchar(20) NOT NULL CONSTRAINT DF_app_equipment_monitor_events_state DEFAULT N'open',
            title nvarchar(300) NOT NULL,
            message nvarchar(2000) NULL,
            [value] nvarchar(max) NULL,
            occurred_at datetimeoffset(3) NOT NULL,
            received_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_equipment_monitor_events_received DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            acknowledged_at datetimeoffset(3) NULL,
            acknowledged_by uniqueidentifier NULL,
            resolved_at datetimeoffset(3) NULL,
            repair_request_id uniqueidentifier NULL,
            raw_payload nvarchar(max) NULL,
            CONSTRAINT PK_app_equipment_monitor_events PRIMARY KEY CLUSTERED (event_id),
            CONSTRAINT CK_app_equipment_monitor_events_severity CHECK (severity IN (N'info',N'warning',N'critical')),
            CONSTRAINT CK_app_equipment_monitor_events_state CHECK (event_state IN (N'open',N'acknowledged',N'resolved',N'suppressed')),
            CONSTRAINT CK_app_equipment_monitor_events_value_json CHECK ([value] IS NULL OR ISJSON([value], VALUE) = 1),
            CONSTRAINT CK_app_equipment_monitor_events_payload_json CHECK (raw_payload IS NULL OR ISJSON(raw_payload, VALUE) = 1)
        );
    END;

    IF OBJECT_ID(N'app.materials', N'U') IS NULL
    BEGIN
        CREATE TABLE app.materials (
            material_id uniqueidentifier NOT NULL CONSTRAINT DF_app_materials_id DEFAULT NEWSEQUENTIALID(),
            material_code nvarchar(100) NULL,
            material_name nvarchar(200) NOT NULL,
            material_alias nvarchar(200) NULL,
            category_id uniqueidentifier NULL,
            sub_category nvarchar(150) NULL,
            material_type nvarchar(100) NULL,
            status nvarchar(20) NOT NULL CONSTRAINT DF_app_materials_status DEFAULT N'active',
            floor nvarchar(20) NULL,
            space_id uniqueidentifier NULL,
            equipment_id uniqueidentifier NULL,
            location_id uniqueidentifier NULL,
            brand nvarchar(150) NULL,
            manufacturer nvarchar(200) NULL,
            model nvarchar(150) NULL,
            specification nvarchar(1000) NULL,
            size nvarchar(150) NULL,
            color nvarchar(100) NULL,
            material_txt nvarchar(300) NULL,
            unit nvarchar(50) NULL,
            weight nvarchar(100) NULL,
            capacity nvarchar(100) NULL,
            voltage nvarchar(100) NULL,
            current_a nvarchar(100) NULL,
            power nvarchar(100) NULL,
            frequency nvarchar(100) NULL,
            pressure nvarchar(100) NULL,
            temperature_range nvarchar(100) NULL,
            waterproof_level nvarchar(100) NULL,
            ip_rating nvarchar(50) NULL,
            supplier nvarchar(200) NULL,
            supplier_code nvarchar(100) NULL,
            original_manufacturer nvarchar(200) NULL,
            country nvarchar(100) NULL,
            purchase_price decimal(14,2) NULL,
            currency nvarchar(10) NULL CONSTRAINT DF_app_materials_currency DEFAULT N'TWD',
            warranty nvarchar(200) NULL,
            lead_time int NULL,
            safety_stock decimal(14,2) NULL,
            current_stock decimal(14,2) NULL,
            maximum_stock decimal(14,2) NULL,
            minimum_stock decimal(14,2) NULL,
            storage_location nvarchar(300) NULL,
            shelf nvarchar(100) NULL,
            batch_number nvarchar(150) NULL,
            expiry_date date NULL,
            qr_code nvarchar(1000) NULL,
            barcode nvarchar(200) NULL,
            rfid nvarchar(200) NULL,
            asset_tag nvarchar(200) NULL,
            product_image nvarchar(2048) NULL,
            datasheet_url nvarchar(2048) NULL,
            manual_url nvarchar(2048) NULL,
            sds_url nvarchar(2048) NULL,
            certificate_url nvarchar(2048) NULL,
            cad_file_url nvarchar(2048) NULL,
            bim_file_url nvarchar(2048) NULL,
            inspection_required bit NOT NULL CONSTRAINT DF_app_materials_inspection DEFAULT 0,
            inspection_cycle nvarchar(150) NULL,
            maintenance_cycle nvarchar(150) NULL,
            replacement_cycle nvarchar(150) NULL,
            critical_level nvarchar(50) NULL,
            risk_level nvarchar(50) NULL,
            description nvarchar(2000) NULL,
            remark nvarchar(2000) NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_materials_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            updated_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_materials_updated DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            created_by uniqueidentifier NULL,
            updated_by uniqueidentifier NULL,
            CONSTRAINT PK_app_materials PRIMARY KEY CLUSTERED (material_id),
            CONSTRAINT CK_app_materials_status CHECK (status IN (N'active',N'inactive'))
        );
    END;

    IF OBJECT_ID(N'app.meeting_booking_change_requests', N'U') IS NULL
    BEGIN
        CREATE TABLE app.meeting_booking_change_requests (
            request_id uniqueidentifier NOT NULL CONSTRAINT DF_app_meeting_change_id DEFAULT NEWSEQUENTIALID(),
            target_booking_id uniqueidentifier NOT NULL,
            requester_id uniqueidentifier NOT NULL,
            requested_meeting_name nvarchar(300) NOT NULL,
            requester_phone nvarchar(50) NULL,
            contact_phone nvarchar(50) NOT NULL,
            reason nvarchar(2000) NULL,
            status nvarchar(20) NOT NULL CONSTRAINT DF_app_meeting_change_status DEFAULT N'pending',
            responded_by uniqueidentifier NULL,
            responded_at datetimeoffset(3) NULL,
            response_note nvarchar(2000) NULL,
            created_booking_id uniqueidentifier NULL,
            created_at datetimeoffset(3) NOT NULL CONSTRAINT DF_app_meeting_change_created DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
            CONSTRAINT PK_app_meeting_booking_change_requests PRIMARY KEY CLUSTERED (request_id),
            CONSTRAINT CK_app_meeting_booking_change_requests_status CHECK (status IN (N'pending',N'approved',N'rejected',N'cancelled'))
        );
    END;

    ---------------------------------------------------------------------------
    -- Idempotent indexes. Indexed text columns are deliberately bounded.
    ---------------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_contracts') AND name=N'IX_app_equipment_contracts_equipment_end')
        CREATE INDEX IX_app_equipment_contracts_equipment_end ON app.equipment_contracts(equipment_id, ends_on);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_contracts') AND name=N'UX_app_equipment_contracts_import')
        CREATE UNIQUE INDEX UX_app_equipment_contracts_import ON app.equipment_contracts(import_key) WHERE import_key IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_plans') AND name=N'UX_app_equipment_maintenance_plans_item')
        CREATE UNIQUE INDEX UX_app_equipment_maintenance_plans_item ON app.equipment_maintenance_plans(equipment_id, item_name);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_plans') AND name=N'IX_app_equipment_maintenance_plans_due')
        CREATE INDEX IX_app_equipment_maintenance_plans_due ON app.equipment_maintenance_plans(next_due_on, status);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_records') AND name=N'UX_app_equipment_maintenance_records_import')
        CREATE UNIQUE INDEX UX_app_equipment_maintenance_records_import ON app.equipment_maintenance_records(import_key) WHERE import_key IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_records') AND name=N'IX_app_equipment_maintenance_records_equipment_date')
        CREATE INDEX IX_app_equipment_maintenance_records_equipment_date ON app.equipment_maintenance_records(equipment_id, performed_on DESC);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_documents') AND name=N'UX_app_equipment_documents_current')
        CREATE UNIQUE INDEX UX_app_equipment_documents_current ON app.equipment_documents(equipment_id, document_type, title) WHERE is_current = 1;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_documents') AND name=N'IX_app_equipment_documents_equipment')
        CREATE INDEX IX_app_equipment_documents_equipment ON app.equipment_documents(equipment_id, document_type);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_documents') AND name=N'UX_app_equipment_documents_import')
        CREATE UNIQUE INDEX UX_app_equipment_documents_import ON app.equipment_documents(import_key) WHERE import_key IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_annual_costs') AND name=N'IX_app_equipment_annual_costs_year')
        CREATE INDEX IX_app_equipment_annual_costs_year ON app.equipment_annual_costs(fiscal_year);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_monitor_events') AND name=N'UX_app_equipment_monitor_events_external')
        CREATE UNIQUE INDEX UX_app_equipment_monitor_events_external ON app.equipment_monitor_events(external_system, external_event_key)
        WHERE external_system IS NOT NULL AND external_event_key IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_monitor_events') AND name=N'IX_app_equipment_monitor_events_equipment_time')
        CREATE INDEX IX_app_equipment_monitor_events_equipment_time ON app.equipment_monitor_events(equipment_id, occurred_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.equipment_monitor_events') AND name=N'IX_app_equipment_monitor_events_state')
        CREATE INDEX IX_app_equipment_monitor_events_state ON app.equipment_monitor_events(event_state, severity, occurred_at DESC);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.materials') AND name=N'UX_app_materials_code')
        CREATE UNIQUE INDEX UX_app_materials_code ON app.materials(material_code) WHERE material_code IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.materials') AND name=N'IX_app_materials_floor')
        CREATE INDEX IX_app_materials_floor ON app.materials(floor);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.materials') AND name=N'IX_app_materials_category')
        CREATE INDEX IX_app_materials_category ON app.materials(category_id);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.meeting_booking_change_requests') AND name=N'IX_app_meeting_change_target')
        CREATE INDEX IX_app_meeting_change_target ON app.meeting_booking_change_requests(target_booking_id, created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.meeting_booking_change_requests') AND name=N'IX_app_meeting_change_requester')
        CREATE INDEX IX_app_meeting_change_requester ON app.meeting_booking_change_requests(requester_id, created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'app.meeting_booking_change_requests') AND name=N'UX_app_meeting_change_pending')
        CREATE UNIQUE INDEX UX_app_meeting_change_pending ON app.meeting_booking_change_requests(target_booking_id, requester_id) WHERE status = N'pending';

    ---------------------------------------------------------------------------
    -- Provenance tags and drift guard.
    ---------------------------------------------------------------------------
    IF @ExistingTargetCount = 0
    BEGIN
        DECLARE @PropertyTable sysname;
        DECLARE migration_property_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT table_name FROM @ExpectedTarget ORDER BY ordinal;
        OPEN migration_property_cursor;
        FETCH NEXT FROM migration_property_cursor INTO @PropertyTable;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC sys.sp_addextendedproperty
                @name=N'InspectionMigrationId', @value=@MigrationId,
                @level0type=N'SCHEMA', @level0name=N'app',
                @level1type=N'TABLE', @level1name=@PropertyTable;
            FETCH NEXT FROM migration_property_cursor INTO @PropertyTable;
        END;
        CLOSE migration_property_cursor;
        DEALLOCATE migration_property_cursor;
    END;

    CREATE TABLE #TargetFingerprint (
        table_name sysname NOT NULL PRIMARY KEY,
        column_sha256 char(64) NOT NULL,
        constraint_sha256 char(64) NOT NULL,
        index_sha256 char(64) NOT NULL
    );

    INSERT #TargetFingerprint(table_name, column_sha256, constraint_sha256, index_sha256)
    SELECT
        e.table_name,
        LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', COALESCE(col.signature_text, N'<none>')), 2)),
        LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', COALESCE(con.signature_text, N'<none>')), 2)),
        LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', COALESCE(idx.signature_text, N'<none>')), 2))
    FROM @ExpectedTarget e
    JOIN sys.tables t ON t.name=e.table_name
    JOIN sys.schemas s ON s.schema_id=t.schema_id AND s.name=N'app'
    OUTER APPLY (
        SELECT STRING_AGG(CONVERT(nvarchar(max), CONCAT(
            c.column_id,N'|',QUOTENAME(c.name),N'|',QUOTENAME(ts.name),N'.',QUOTENAME(ty.name),N'|',
            c.max_length,N'|',c.precision,N'|',c.scale,N'|',c.is_nullable,N'|',c.is_identity,N'|',
            COALESCE(CONVERT(nvarchar(100),ic.seed_value),N'<null>'),N'|',COALESCE(CONVERT(nvarchar(100),ic.increment_value),N'<null>'),N'|',
            c.is_computed,N'|',COALESCE(cc.definition,N'<null>'),N'|',COALESCE(c.collation_name,N'<null>'),N'|',
            COALESCE(dc.definition,N'<null>'),N'|',c.is_rowguidcol,N'|',c.is_filestream,N'|',c.is_sparse,N'|',c.is_column_set
        )),NCHAR(30)) WITHIN GROUP (ORDER BY c.column_id) AS signature_text
        FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id=c.user_type_id
        JOIN sys.schemas ts ON ts.schema_id=ty.schema_id
        LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
        LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
        LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
        WHERE c.object_id=t.object_id
    ) col
    OUTER APPLY (
        SELECT STRING_AGG(CONVERT(nvarchar(max), q.item),NCHAR(30)) WITHIN GROUP (ORDER BY q.sort_key) AS signature_text
        FROM (
            SELECT CONCAT(N'1|',ck.name) AS sort_key,
                   CONCAT(N'CHECK|',QUOTENAME(ck.name),N'|',ck.parent_column_id,N'|',ck.is_disabled,N'|',ck.is_not_trusted,N'|',ck.is_system_named,N'|',ck.definition) AS item
            FROM sys.check_constraints ck WHERE ck.parent_object_id=t.object_id
            UNION ALL
            SELECT CONCAT(N'2|',fk.name,N'|',RIGHT(N'00000'+CONVERT(nvarchar(5),fkc.constraint_column_id),5)),
                   CONCAT(N'FK|',QUOTENAME(fk.name),N'|',fkc.constraint_column_id,N'|',QUOTENAME(pc.name),N'|',
                          QUOTENAME(rs.name),N'.',QUOTENAME(rt.name),N'|',QUOTENAME(rc.name),N'|',
                          fk.delete_referential_action,N'|',fk.update_referential_action,N'|',fk.is_disabled,N'|',fk.is_not_trusted,N'|',fk.is_system_named)
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
            JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id
            JOIN sys.tables rt ON rt.object_id=fkc.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
            JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id
            WHERE fk.parent_object_id=t.object_id
        ) q
    ) con
    OUTER APPLY (
        SELECT STRING_AGG(CONVERT(nvarchar(max), CONCAT(
            QUOTENAME(i.name),N'|',i.type,N'|',i.is_unique,N'|',i.is_primary_key,N'|',i.is_unique_constraint,N'|',
            i.is_disabled,N'|',i.is_hypothetical,N'|',i.ignore_dup_key,N'|',i.allow_row_locks,N'|',i.allow_page_locks,N'|',
            i.fill_factor,N'|',i.has_filter,N'|',COALESCE(i.filter_definition,N'<null>'),N'|',
            ix.key_ordinal,N'|',ix.is_descending_key,N'|',ix.is_included_column,N'|',ix.index_column_id,N'|',QUOTENAME(c.name)
        )),NCHAR(30)) WITHIN GROUP (ORDER BY i.index_id, ix.key_ordinal, ix.index_column_id) AS signature_text
        FROM sys.indexes i
        JOIN sys.index_columns ix ON ix.object_id=i.object_id AND ix.index_id=i.index_id
        JOIN sys.columns c ON c.object_id=ix.object_id AND c.column_id=ix.column_id
        WHERE i.object_id=t.object_id AND i.index_id>0
    ) idx;

    IF EXISTS (
        SELECT 1
        FROM @ExpectedTarget e
        JOIN sys.tables t ON t.name=e.table_name
        JOIN sys.schemas s ON s.schema_id=t.schema_id AND s.name=N'app'
        CROSS APPLY (SELECT COUNT(*) AS actual_columns FROM sys.columns c WHERE c.object_id=t.object_id) x
        WHERE x.actual_columns <> e.expected_columns
    )
        THROW 51030, N'An app target table column count does not match the canonical migration manifest.', 1;

    DECLARE @ExpectedFingerprint table (
        table_name sysname NOT NULL PRIMARY KEY,
        column_sha256 char(64) NOT NULL,
        constraint_sha256 char(64) NOT NULL,
        index_sha256 char(64) NOT NULL
    );

    INSERT @ExpectedFingerprint(table_name,column_sha256,constraint_sha256,index_sha256)
    VALUES
      (N'equipment_annual_costs',N'9e1be6dfaaccbbe597b7940d66bb215dff573456bf1b27641b2fc6225d139277',N'3ecac830a80a1efadcac7987dd9991df6513955c630ef02e1172b44f705635d9',N'7a5302fa90fdba731e18778d5ed689ffc0431fe54cbba20f823b389edae570d6'),
      (N'equipment_contracts',N'4dd22f57d4dbfca92fd79e5207dbe1124a954b704b08c73f9d155a6a62edc6b9',N'e0377ca33f4aaa2e481549e6e18fd8871dd4e7c020f9b968914de3d9ab352904',N'936e3881c9d3918874be26cd775f281c2f3daba45f6c8afd193b839787ba6266'),
      (N'equipment_documents',N'cb5859e8447a466c9d2ded42934424acbfd2c356c87db6f9fb2f22fba99aa8c8',N'8ce44453b4a6ba2911f211a72e68162b0182202be4f7c2ff2d2a2ea08d443e9b',N'de2a84efc7413afa02472d064eecd137948666967669af99891d74797c172d9a'),
      (N'equipment_maintenance_plans',N'47dbc409cf8aee2bde0dbe61f933f6cef7944860af5c469f05bf7599f28d660b',N'993319d5163c15b94f4c4cfa5693480da2cb9488fb3cb1aef240cfc2d7c57943',N'6d9bf06c51946ce9a1e17bad76a16b1d762bda67dbcaa608bf7363dc3b8d8104'),
      (N'equipment_maintenance_records',N'70f746d89b13cd9011c363407568637457a068038ac0322a8ffff898bc9f3a40',N'f2c142724b452b66f78a690f6d3fb9dff1e7edc549f1639e496751d2e9d69e80',N'a1fbe76048626afa92feb216c0f8c2a44df1c9f46db0b2a0a276f55ea38f2559'),
      (N'equipment_monitor_events',N'6268ee1b594d27efa123e8aa134232b1e072af40c123c38486690d12e39786aa',N'1c6a52263ba4ef680bddde407da06bc42389b801b91330b0e89e9aa70f453c5f',N'7f04f203543b9f475fe857cd3596b4042e51c15da239e73441bac9af6fa73339'),
      (N'materials',N'bd0f9dab3d485582c60a69a20c725538093a6f2992fa9693514b76c5729fcef4',N'68309348775569261779ceb8d5cf6d4b8e6b35ae5756adaba558061817ccd6b9',N'49d0632728e005768a04ffe69ef31405306c75ab6cb0035d20c194c4f6e8afbb'),
      (N'meeting_booking_change_requests',N'415133895680e35ec9eecd27769596ce8f06bfe280498fa2c67a14e629ad51f8',N'9da9476e51d44fb227955827f55bee189acc7d3815fa12b9c5ebdea188efa17a',N'bab37ed445d516d970ee468cd62af85f56fe3c10c7f05145857eb2fefca8da2d');

    IF EXISTS (
        SELECT 1
        FROM @ExpectedFingerprint e
        FULL JOIN #TargetFingerprint a ON a.table_name=e.table_name
        WHERE e.table_name IS NULL OR a.table_name IS NULL
           OR a.column_sha256<>e.column_sha256
           OR a.constraint_sha256<>e.constraint_sha256
           OR a.index_sha256<>e.index_sha256
    )
        THROW 51032, N'Canonical target schema drift detected in columns, defaults, constraints, or indexes.', 1;

    CREATE TABLE #TargetManifest (
        ordinal int NOT NULL,
        table_name sysname NOT NULL,
        canonical_source nvarchar(260) NOT NULL,
        expected_columns int NOT NULL,
        actual_columns int NOT NULL,
        target_rows bigint NOT NULL,
        deferred_parent_fks nvarchar(500) NULL
    );

    INSERT #TargetManifest
    SELECT 1,N'equipment_contracts',N'system/sql/equipment_lifecycle.sql:135-167',18,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_contracts')),
           (SELECT COUNT_BIG(*) FROM app.equipment_contracts),N'equipment_id,created_by,updated_by'
    UNION ALL SELECT 2,N'equipment_maintenance_plans',N'system/sql/equipment_lifecycle.sql:73-101',22,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_plans')),
           (SELECT COUNT_BIG(*) FROM app.equipment_maintenance_plans),N'equipment_id,responsible_user_id,created_by,updated_by'
    UNION ALL SELECT 3,N'equipment_maintenance_records',N'system/sql/equipment_lifecycle.sql:104-132',21,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_maintenance_records')),
           (SELECT COUNT_BIG(*) FROM app.equipment_maintenance_records),N'equipment_id,source_order_id,created_by'
    UNION ALL SELECT 4,N'equipment_documents',N'system/sql/equipment_lifecycle.sql:170-193',14,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_documents')),
           (SELECT COUNT_BIG(*) FROM app.equipment_documents),N'equipment_id,uploaded_by'
    UNION ALL SELECT 5,N'equipment_annual_costs',N'system/sql/equipment_lifecycle.sql:196-212',13,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_annual_costs')),
           (SELECT COUNT_BIG(*) FROM app.equipment_annual_costs),N'equipment_id,created_by,updated_by'
    UNION ALL SELECT 6,N'equipment_monitor_events',N'system/sql/equipment_lifecycle.sql:270-294',18,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.equipment_monitor_events')),
           (SELECT COUNT_BIG(*) FROM app.equipment_monitor_events),N'equipment_id,point_id,acknowledged_by,repair_request_id'
    UNION ALL SELECT 7,N'materials',N'system/sql/material_master.sql:28-78',69,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.materials')),
           (SELECT COUNT_BIG(*) FROM app.materials),N'category_id,space_id,equipment_id,location_id,created_by,updated_by'
    UNION ALL SELECT 8,N'meeting_booking_change_requests',N'supabase/migrations/20260805143000_meeting_booking_change_requests.sql:8-40',13,
           (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'app.meeting_booking_change_requests')),
           (SELECT COUNT_BIG(*) FROM app.meeting_booking_change_requests),N'target_booking_id,requester_id,responded_by,created_booking_id';

    IF @PreviouslyApplied = 0 AND EXISTS (SELECT 1 FROM #TargetManifest WHERE target_rows <> 0)
        THROW 51031, N'New operational tables were expected to be empty.', 1;

    ---------------------------------------------------------------------------
    -- IIS identity: read-only until workflows and stored procedures are ready.
    ---------------------------------------------------------------------------
    IF DATABASE_PRINCIPAL_ID(N'NT AUTHORITY\LOCAL SERVICE') IS NULL
        EXEC(N'CREATE USER [NT AUTHORITY\LOCAL SERVICE] FOR LOGIN [NT AUTHORITY\LOCAL SERVICE];');
    IF IS_ROLEMEMBER(N'db_owner', N'NT AUTHORITY\LOCAL SERVICE') = 1
        THROW 51040, N'LOCAL SERVICE must not be db_owner; DENY could be bypassed or changed.', 1;

    GRANT SELECT ON SCHEMA::app TO [NT AUTHORITY\LOCAL SERVICE];
    DENY INSERT, UPDATE, DELETE ON SCHEMA::app TO [NT AUTHORITY\LOCAL SERVICE];

    DECLARE @CanSelect int, @CanInsert int, @CanUpdate int, @CanDelete int;
    EXECUTE AS USER = N'NT AUTHORITY\LOCAL SERVICE';
    SELECT
        @CanSelect = HAS_PERMS_BY_NAME(N'app.equipment_contracts', N'OBJECT', N'SELECT'),
        @CanInsert = HAS_PERMS_BY_NAME(N'app.equipment_contracts', N'OBJECT', N'INSERT'),
        @CanUpdate = HAS_PERMS_BY_NAME(N'app.equipment_contracts', N'OBJECT', N'UPDATE'),
        @CanDelete = HAS_PERMS_BY_NAME(N'app.equipment_contracts', N'OBJECT', N'DELETE');
    REVERT;

    IF @CanSelect <> 1 OR @CanInsert <> 0 OR @CanUpdate <> 0 OR @CanDelete <> 0
        THROW 51041, N'LOCAL SERVICE effective app schema permissions failed verification.', 1;

    IF NOT EXISTS (SELECT 1 FROM app.schema_migration_history WHERE migration_id=@MigrationId)
    BEGIN
        INSERT app.schema_migration_history(
            migration_id,script_sha256,source_manifest_sha256,source_schema,target_schema,
            table_count,source_row_count,status,first_applied_at,last_verified_at,applied_by,approval_reference
        ) VALUES (
            @MigrationId,@ScriptSha256,@SourceManifestSha256,N'supabase_import',N'app',
            8,0,CASE WHEN @MigrationMode=N'COMMIT' THEN N'committed' ELSE N'validated' END,
            TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),ORIGINAL_LOGIN(),@ApprovalReference
        );
    END
    ELSE
    BEGIN
        UPDATE app.schema_migration_history
           SET last_verified_at=TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00'),
               status=N'committed',
               approval_reference=@ApprovalReference
         WHERE migration_id=@MigrationId;
    END;

    SELECT
        N'SOURCE_PREFLIGHT' AS result_set,
        s.table_name,
        s.source_rows,
        s.staging_columns,
        s.source_payload_sha256
    FROM #StagingManifest s
    ORDER BY s.table_name;

    SELECT
        N'TARGET_MANIFEST' AS result_set,
        t.ordinal,
        t.table_name,
        t.canonical_source,
        t.expected_columns,
        t.actual_columns,
        t.target_rows,
        t.deferred_parent_fks
    FROM #TargetManifest t
    ORDER BY t.ordinal;

    SELECT
        N'SCHEMA_FINGERPRINT' AS result_set,
        f.table_name,
        f.column_sha256,
        f.constraint_sha256,
        f.index_sha256
    FROM #TargetFingerprint f
    ORDER BY f.table_name;

    SELECT
        N'PERMISSION_CHECK' AS result_set,
        N'NT AUTHORITY\LOCAL SERVICE' AS principal_name,
        @CanSelect AS can_select,
        @CanInsert AS can_insert,
        @CanUpdate AS can_update,
        @CanDelete AS can_delete;

    SELECT
        N'MIGRATION_MANIFEST' AS result_set,
        @MigrationId AS migration_id,
        @MigrationMode AS requested_mode,
        @ScriptSha256 AS script_sha256,
        @SourceManifestSha256 AS source_manifest_sha256,
        @ApprovalReference AS approval_reference,
        @NetTransport AS net_transport,
        @PreviouslyApplied AS previously_applied,
        8 AS target_table_count,
        0 AS source_row_count,
        N'Parent business-key foreign keys intentionally deferred' AS note;

    IF @MigrationMode = N'ROLLBACK'
    BEGIN
        ROLLBACK TRANSACTION;
        PRINT CONCAT(N'FINAL_STATUS|ROLLED_BACK|', @MigrationId);
    END
    ELSE
    BEGIN
        COMMIT TRANSACTION;
        PRINT CONCAT(N'FINAL_STATUS|COMMITTED|', @MigrationId);
    END;
END TRY
BEGIN CATCH
    IF USER_NAME() = N'NT AUTHORITY\LOCAL SERVICE'
        REVERT;
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
