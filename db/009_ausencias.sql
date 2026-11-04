/* =====================================================================
   Script 009 - Ausencias justificadas y documentos
   - fich.MotivosAusencia: lista que gestiona ADMIN (arranca con los permisos del art. 37 ET).
   - fich.Ausencias: horas de un día o días completos, con motivo y comentario. Estados:
     PENDIENTE, APROBADA, RECHAZADA (con motivo), RETIRADA (por el empleado).
   - fich.Documentos: metadatos de los archivos guardados en Azure Blob Storage
     (justificantes ahora; nóminas más adelante). El archivo no se guarda en la BD.
   Requiere los scripts 006-008. Ejecutar en sqldb-fichajes-prod ANTES de fusionar el PR.
   ===================================================================== */
SET XACT_ABORT ON;
GO

CREATE TABLE fich.MotivosAusencia (
    MotivoId              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MotivosAusencia PRIMARY KEY,
    Nombre                NVARCHAR(100) NOT NULL CONSTRAINT UQ_MotivosAusencia_Nombre UNIQUE,
    RequiereJustificante  BIT NOT NULL CONSTRAINT DF_Motivos_Requiere DEFAULT (0),
    Orden                 INT NOT NULL CONSTRAINT DF_Motivos_Orden DEFAULT (100),
    Activo                BIT NOT NULL CONSTRAINT DF_Motivos_Activo DEFAULT (1)
);
GO

INSERT INTO fich.MotivosAusencia (Nombre, RequiereJustificante, Orden) VALUES
 (N'Enfermedad o visita médica', 1, 10),
 (N'Fuerza mayor (motivo familiar urgente)', 0, 20),
 (N'Accidente, enfermedad grave u hospitalización de familiar', 1, 30),
 (N'Fallecimiento de familiar', 1, 40),
 (N'Matrimonio o registro de pareja de hecho', 1, 50),
 (N'Traslado de domicilio', 1, 60),
 (N'Deber público y personal', 1, 70),
 (N'Exámenes', 1, 80),
 (N'Exámenes prenatales y preparación al parto', 1, 90),
 (N'Funciones sindicales o de representación', 0, 100),
 (N'Otros', 0, 999);
GO

CREATE TABLE fich.Ausencias (
    AusenciaId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Ausencias PRIMARY KEY,
    UsuarioId      INT NOT NULL CONSTRAINT FK_Ausencias_Usuario REFERENCES fich.Usuarios(UsuarioId),
    MotivoId       INT NOT NULL CONSTRAINT FK_Ausencias_Motivo REFERENCES fich.MotivosAusencia(MotivoId),
    FechaInicio    DATE NOT NULL,
    FechaFin       DATE NOT NULL,
    HoraInicio     TIME(0) NULL,                 -- con horas: un solo día (FechaInicio = FechaFin)
    HoraFin        TIME(0) NULL,
    Comentario     NVARCHAR(500) NULL,
    Estado         VARCHAR(12) NOT NULL CONSTRAINT DF_Ausencias_Estado DEFAULT ('PENDIENTE'),
    CreadoUtc      DATETIME2(0) NOT NULL CONSTRAINT DF_Ausencias_Creado DEFAULT (SYSUTCDATETIME()),
    ResueltaPorId  INT NULL CONSTRAINT FK_Ausencias_ResueltaPor REFERENCES fich.Usuarios(UsuarioId),
    ResueltaUtc    DATETIME2(0) NULL,
    MotivoRechazo  NVARCHAR(500) NULL,
    CONSTRAINT CK_Ausencias_Estado CHECK (Estado IN ('PENDIENTE','APROBADA','RECHAZADA','RETIRADA')),
    CONSTRAINT CK_Ausencias_Fechas CHECK (FechaFin >= FechaInicio),
    CONSTRAINT CK_Ausencias_Horas CHECK (
        (HoraInicio IS NULL AND HoraFin IS NULL) OR
        (HoraInicio IS NOT NULL AND HoraFin IS NOT NULL AND HoraFin > HoraInicio AND FechaInicio = FechaFin))
);
GO

CREATE INDEX IX_Ausencias_Usuario ON fich.Ausencias(UsuarioId, FechaInicio, FechaFin) INCLUDE (Estado);
GO

CREATE INDEX IX_Ausencias_Estado ON fich.Ausencias(Estado) INCLUDE (UsuarioId);
GO

CREATE TABLE fich.Documentos (
    DocumentoId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Documentos PRIMARY KEY,
    Tipo            VARCHAR(15) NOT NULL,          -- JUSTIFICANTE (NOMINA más adelante)
    UsuarioId       INT NOT NULL CONSTRAINT FK_Documentos_Usuario REFERENCES fich.Usuarios(UsuarioId),
    AusenciaId      INT NULL CONSTRAINT FK_Documentos_Ausencia REFERENCES fich.Ausencias(AusenciaId),
    Contenedor      VARCHAR(63) NOT NULL,
    Ruta            NVARCHAR(400) NOT NULL,
    NombreOriginal  NVARCHAR(200) NOT NULL,
    TipoMime        VARCHAR(100) NOT NULL,
    Bytes           INT NOT NULL,
    Sha256          CHAR(64) NOT NULL,
    SubidoPorId     INT NOT NULL CONSTRAINT FK_Documentos_SubidoPor REFERENCES fich.Usuarios(UsuarioId),
    SubidoUtc       DATETIME2(0) NOT NULL CONSTRAINT DF_Documentos_Subido DEFAULT (SYSUTCDATETIME()),
    BorradoUtc      DATETIME2(0) NULL,
    CONSTRAINT CK_Documentos_Tipo CHECK (Tipo IN ('JUSTIFICANTE','NOMINA'))
);
GO

CREATE INDEX IX_Documentos_Ausencia ON fich.Documentos(AusenciaId) WHERE AusenciaId IS NOT NULL;
GO

CREATE INDEX IX_Documentos_Usuario ON fich.Documentos(UsuarioId, Tipo, SubidoUtc);
GO

/* ---------- Permisos de la API ---------- */
GRANT SELECT, INSERT, UPDATE ON fich.MotivosAusencia TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Ausencias       TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Documentos      TO app_fichajes;
GO

SELECT 'Script 009 aplicado' AS Resultado;
