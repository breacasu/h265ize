USE [SRS_Cable_BN125]
GO
/****** Object:  StoredProcedure [dbo].[procInsertScan]    Script Date: 09.10.2025 08:41:38 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[procInsertScan] 
    @cableName varchar(255), 
    @status int,
    @userName varchar(255),
    @created datetime,
    @comment varchar(255),
    @EndSelector varchar(10) = NULL,  -- Neuer optionaler Parameter
    @LocationIdentifier varchar(255) = NULL  -- Neuer Parameter für LocationIdentifier
AS
BEGIN
    -- Validierung: Wenn Status 2 ist, muss EndSelector gesetzt sein
    IF @status = 2 AND (@EndSelector IS NULL OR @EndSelector = '')
    BEGIN
        RAISERROR('EndSelector ist erforderlich wenn Status 2 ist', 16, 1)
        RETURN
    END

    -- Validierung: EndSelector muss FROM oder TO sein (wenn gesetzt)
    IF @EndSelector IS NOT NULL AND @EndSelector != '' 
        AND UPPER(@EndSelector) NOT IN ('FROM', 'TO')
    BEGIN
        RAISERROR('EndSelector muss FROM oder TO sein', 16, 1)
        RETURN
    END

    DECLARE @userId AS uniqueidentifier
    SELECT @userId = [Id] FROM [User] WHERE [UserIdentifier] = @userName

    DECLARE @cableId AS uniqueidentifier
    SELECT @cableId = [Id] FROM [CableMounting] WHERE [CableIdentifier] = @cableName

    IF UPPER(@EndSelector) = 'FROM'
    BEGIN
        INSERT INTO [CableMountingLog] 
            ([CableMountingId], [CableEnd], [Status], [LocationIdentifier], [UserId], [Created], [Date], [Comment])
        VALUES 
            (@cableId, 1, @status, @LocationIdentifier, @userId, GETDATE(), @created, @comment)
    END
    ELSE IF UPPER(@EndSelector) = 'TO'
    BEGIN
        INSERT INTO [CableMountingLog] 
            ([CableMountingId], [CableEnd], [Status], [LocationIdentifier], [UserId], [Created], [Date], [Comment])
        VALUES 
            (@cableId, 2, @status, @LocationIdentifier, @userId, GETDATE(), @created, @comment)
    END
    ELSE
    BEGIN
        IF @status = 5  -- Gemessen, keine Seite erforderlich
        BEGIN
            INSERT INTO [CableMountingLog] 
                ([CableMountingId], [CableEnd], [Status], [LocationIdentifier], [UserId], [Created], [Date], [Comment])
            VALUES 
                (@cableId, 0, @status, @LocationIdentifier, @userId, GETDATE(), @created, @comment)
        END
        ELSE
        BEGIN
            INSERT INTO [CableMountingLog] 
                ([CableMountingId], [CableEnd], [Status], [LocationIdentifier], [UserId], [Created], [Date], [Comment])
            VALUES 
                (@cableId, 1, @status, @LocationIdentifier, @userId, GETDATE(), @created, @comment)

            INSERT INTO [CableMountingLog] 
                ([CableMountingId], [CableEnd], [Status], [LocationIdentifier], [UserId], [Created], [Date], [Comment])
            VALUES 
                (@cableId, 2, @status, @LocationIdentifier, @userId, GETDATE(), @created, @comment)
        END
    END
END