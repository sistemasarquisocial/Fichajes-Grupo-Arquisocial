/* =====================================================================
   Script 007 - Incidencias de fichaje y correcciones
   - fich.Incidencias: solicitud del empleado (cambiar hora, añadir fichaje olvidado
     o anular fichaje erróneo) con comentario obligatorio. Estados:
     PENDIENTE, ACEPTADA, RECHAZADA (con motivo), RETIRADA (por el empleado).
   - fich.CorreccionesFichaje (LEDGER append-only): correcciones aprobadas.
     Los fichajes originales NUNCA se modifican: la app aplica la corrección encima
     y muestra el original como "corregido".
   Requiere el script 006. Ejecutar en sqldb-fichajes-prod ANTES de fusionar el PR.
   ===================================================================== */
SET XACT_ABORT ON;
GO

CREATE TABLE fich.Incidencias (
    IncidenciaId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Incidencias PRIMARY KEY,
    UsuarioId             INT NOT NULL CONSTRAINT FK_Incidencias_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Tipo                  VARCHAR(15) NOT NULL,
    FichajeId             BIGINT NULL CONSTRAINT FK_Incidencias_Fichaje REFERENCES fich.Fichajes(FichajeId),
    TipoFichaje           VARCHAR(20) NOT NULL,
    FechaHoraOriginalUtc  DATETIME2(0) NULL,
    FechaHoraPropuestaUtc DATETIME2(0) NULL,
    Comentario            NVARCHAR(500) NOT NULL,
    Estado                VARCHAR(12) NOT NULL CONSTRAINT DF_Incidencias_Estado DEFAULT ('PENDIENTE'),
    CreadoUtc             DATETIME2(0) NOT NULL CONSTRAINT DF_Incidencias_Creado DEFAULT (SYSUTCDATETIME()),
    ResueltaPorId         INT NULL CONSTRAINT FK_Incidencias_ResueltaPor REFERENCES fich.Usuarios(UsuarioId),
    ResueltaUtc           DATETIME2(0) NULL,
    MotivoRechazo         NVARCHAR(500) NULL,
    CONSTRAINT CK_Incidencias_Tipo   CHECK (Tipo IN ('CAMBIAR_HORA','ANADIR','ANULAR')),
    CONSTRAINT CK_Incidencias_Estado CHECK (Estado IN ('PENDIENTE','ACEPTADA','RECHAZADA','RETIRADA')),
    CONSTRAINT CK_Incidencias_TipoFichaje CHECK (TipoFichaje IN ('ENTRADA','SALIDA','PAUSA_INICIO','PAUSA_FIN')),
    CONSTRAINT CK_Incidencias_Datos CHECK (
        (Tipo = 'CAMBIAR_HORA' AND FichajeId IS NOT NULL AND FechaHoraPropuestaUtc IS NOT NULL) OR
        (Tipo = 'ANADIR'       AND FichajeId IS NULL     AND FechaHoraPropuestaUtc IS NOT NULL) OR
        (Tipo = 'ANULAR'       AND FichajeId IS NOT NULL AND FechaHoraPropuestaUtc IS NULL))
);
GO
CREATE INDEX IX_Incidencias_Usuario ON fich.Incidencias(UsuarioId, CreadoUtc DESC);
CREATE INDEX IX_Incidencias_Estado ON fich.Incidencias(Estado) INCLUDE (UsuarioId);
GO

CREATE TABLE fich.CorreccionesFichaje (
    CorreccionId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CorreccionesFichaje PRIMARY KEY,
    IncidenciaId   INT NOT NULL CONSTRAINT FK_Correcciones_Incidencia REFERENCES fich.Incidencias(IncidenciaId),
    UsuarioId      INT NOT NULL CONSTRAINT FK_Correcciones_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Tipo           VARCHAR(15) NOT NULL,
    FichajeId      BIGINT NULL,
    TipoFichaje    VARCHAR(20) NOT NULL,
    FechaHoraUtc   DATETIME2(0) NULL,
    AprobadaPorId  INT NOT NULL CONSTRAINT FK_Correcciones_AprobadaPor REFERENCES fich.Usuarios(UsuarioId),
    AplicadaUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Correcciones_Aplicada DEFAULT (SYSUTCDATETIME())
)
WITH (LEDGER = ON (APPEND_ONLY = ON));
GO
CREATE INDEX IX_Correcciones_Usuario ON fich.CorreccionesFichaje(UsuarioId, FechaHoraUtc);
CREATE INDEX IX_Correcciones_Fichaje ON fich.CorreccionesFichaje(FichajeId) WHERE FichajeId IS NOT NULL;
GO

/* ---------- Permisos de la API ---------- */
GRANT SELECT, INSERT, UPDATE ON fich.Incidencias          TO app_fichajes;
GRANT SELECT, INSERT         ON fich.CorreccionesFichaje  TO app_fichajes;
GO

SELECT 'Script 007 aplicado' AS Resultado;
