/* =====================================================================
   Script 010 - Integración con a3innuva Nómina
   - El conector (Function App func-a3sync-prod) lee de a3 empresas, centros,
     trabajadores y organigrama y los vuelca en tablas fich.A3*.
   - Después concilia: crea o actualiza usuarios de la app y deja en
     fich.A3Pendientes lo que no puede resolver solo.
   - fich.A3Empresas: empresas de a3 (Importar y EmpresaId de la app).
   - fich.A3Centros: centros de a3 y el servicio (fich.Centros) al que
     corresponden (CentroId). Varios centros a3 pueden ir al mismo servicio.
   - fich.Centros.EsEstructura: marca los centros OH (personal de estructura).
   - fich.Usuarios: DNI y datos de a3; PasswordHash pasa a admitir NULL
     (usuarios importados sin contraseña hasta su «Primer acceso»).
   - fich.A3Conexion: estado de la conexión OAuth (los secretos están en Key Vault).
   - fich.A3Sincronizaciones: peticiones e historial de sincronizaciones.
   Ejecutar en sqldb-fichajes-prod ANTES de fusionar el PR.
   El bloque final (usuario de la Function App) se ejecuta cuando exista func-a3sync-prod.
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- Usuarios: datos de a3 y primer acceso ---------- */
ALTER TABLE fich.Usuarios ALTER COLUMN PasswordHash VARCHAR(255) NULL;
GO
ALTER TABLE fich.Usuarios ADD
    DNI               VARCHAR(12)      NULL,
    EmpresaA3         INT              NULL,
    EmpleadoA3        CHAR(6)          NULL,
    IdA3              UNIQUEIDENTIFIER NULL,
    FechaAltaA3       DATE             NULL,
    FechaBajaA3       DATE             NULL,
    OrigenA3          BIT NOT NULL CONSTRAINT DF_Usuarios_OrigenA3 DEFAULT (0),
    DesactivadoPorA3  BIT NOT NULL CONSTRAINT DF_Usuarios_DesactA3 DEFAULT (0),
    PrimerAccesoUtc   DATETIME2(0)     NULL;
GO
CREATE UNIQUE INDEX UX_Usuarios_DNI ON fich.Usuarios(DNI) WHERE DNI IS NOT NULL;
GO

/* ---------- Centros de estructura (OH) ---------- */
ALTER TABLE fich.Centros ADD EsEstructura BIT NOT NULL CONSTRAINT DF_Centros_EsEstructura DEFAULT (0);
GO

/* ---------- Empresas de a3 ---------- */
CREATE TABLE fich.A3Empresas (
    CodigoA3       INT NOT NULL CONSTRAINT PK_A3Empresas PRIMARY KEY,
    Nombre         NVARCHAR(150) NOT NULL,
    CIF            VARCHAR(15)   NULL,
    Importar       BIT NOT NULL CONSTRAINT DF_A3Empresas_Importar DEFAULT (1),
    EmpresaId      INT NULL CONSTRAINT FK_A3Empresas_Empresa REFERENCES fich.Empresas(EmpresaId),
    LastUpdateA3   DATETIME2(3)  NULL,
    ActualizadoUtc DATETIME2(0) NOT NULL CONSTRAINT DF_A3Empresas_Act DEFAULT (SYSUTCDATETIME())
);
GO
CREATE UNIQUE INDEX UX_A3Empresas_EmpresaId ON fich.A3Empresas(EmpresaId) WHERE EmpresaId IS NOT NULL;
GO

/* Empresas ya creadas en la app y copias de prueba de a3 (no se importan) */
INSERT INTO fich.A3Empresas (CodigoA3, Nombre, Importar, EmpresaId)
SELECT 355, N'ARQUISOCIAL, S.L.', 1, (SELECT EmpresaId FROM fich.Empresas WHERE Nombre = N'Arquisocial') UNION ALL
SELECT 1,   N'SANIVIDA, S.L.',    1, (SELECT EmpresaId FROM fich.Empresas WHERE Nombre = N'Sanivida') UNION ALL
SELECT 356, N'FEPAS FUNDACION PARA EL ESTUDIO Y PROMOC', 1, (SELECT EmpresaId FROM fich.Empresas WHERE Nombre = N'Fepas') UNION ALL
SELECT 1112, N'ARTENSIS, S.L. (COPIA)', 0, NULL UNION ALL
SELECT 5055, N'ARQUISOCIAL, S.L. (COPIA)', 0, NULL;
GO

/* ---------- Centros de a3 y su servicio en la app ---------- */
CREATE TABLE fich.A3Centros (
    EmpresaA3       INT NOT NULL,
    CentroA3        INT NOT NULL,
    IdA3            UNIQUEIDENTIFIER NULL,
    Nombre          NVARCHAR(150) NOT NULL,
    Direccion       NVARCHAR(200) NULL,
    CodigoPostal    VARCHAR(10)   NULL,
    Ciudad          NVARCHAR(100) NULL,
    Provincia       NVARCHAR(100) NULL,
    Telefono        VARCHAR(30)   NULL,
    CentroId        INT NULL CONSTRAINT FK_A3Centros_Centro REFERENCES fich.Centros(CentroId),
    Activo          BIT NOT NULL CONSTRAINT DF_A3Centros_Activo DEFAULT (1),
    DetalleLeidoUtc DATETIME2(0) NULL,
    ActualizadoUtc  DATETIME2(0) NOT NULL CONSTRAINT DF_A3Centros_Act DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_A3Centros PRIMARY KEY (EmpresaA3, CentroA3)
);
GO

/* ---------- Trabajadores de a3 (copia de cada registro) ---------- */
CREATE TABLE fich.A3Empleados (
    EmpresaA3        INT NOT NULL,
    EmpleadoA3       CHAR(6) NOT NULL,
    IdA3             UNIQUEIDENTIFIER NULL,
    DNI              VARCHAR(12)   NOT NULL,
    Apellidos        NVARCHAR(150) NOT NULL,
    Nombre           NVARCHAR(100) NOT NULL,
    CentroA3         INT NOT NULL,
    FechaAlta        DATE NULL,
    FechaBaja        DATE NULL,
    EmailProfesional NVARCHAR(254) NULL,
    EmailPersonal    NVARCHAR(254) NULL,
    ContactoLeidoUtc DATETIME2(0)  NULL,
    LastUpdateA3     DATETIME2(3)  NULL,
    UsuarioId        INT NULL CONSTRAINT FK_A3Empleados_Usuario REFERENCES fich.Usuarios(UsuarioId),
    ActualizadoUtc   DATETIME2(0) NOT NULL CONSTRAINT DF_A3Empleados_Act DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_A3Empleados PRIMARY KEY (EmpresaA3, EmpleadoA3)
);
GO
CREATE INDEX IX_A3Empleados_DNI ON fich.A3Empleados(DNI);
GO

/* ---------- Organigrama de a3 ---------- */
CREATE TABLE fich.A3Organigrama (
    NodoId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_A3Organigrama PRIMARY KEY,
    PadreNodoId       UNIQUEIDENTIFIER NULL,
    EmpresaA3         INT NOT NULL,
    UnidadId          UNIQUEIDENTIFIER NULL,
    Tipo              NVARCHAR(100) NULL,
    Codigo            NVARCHAR(50)  NULL,
    Nombre            NVARCHAR(200) NULL,
    Descripcion       NVARCHAR(400) NULL,
    ResponsableCodigo NVARCHAR(20)  NULL,
    ResponsableDNI    VARCHAR(12)   NULL,
    ResponsableNombre NVARCHAR(200) NULL,
    FechaAlta         DATE NULL,
    FechaBaja         DATE NULL,
    Orden             INT NOT NULL CONSTRAINT DF_A3Organigrama_Orden DEFAULT (0),
    ActualizadoUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_A3Organigrama_Act DEFAULT (SYSUTCDATETIME())
);
GO
CREATE INDEX IX_A3Organigrama_Empresa ON fich.A3Organigrama(EmpresaA3);
GO

/* ---------- Bandeja de pendientes ---------- */
CREATE TABLE fich.A3Pendientes (
    PendienteId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_A3Pendientes PRIMARY KEY,
    Tipo          VARCHAR(30)   NOT NULL,
    Clave         NVARCHAR(60)  NOT NULL,
    EmpresaA3     INT NULL,
    EmpleadoA3    CHAR(6) NULL,
    CentroA3      INT NULL,
    Detalle       NVARCHAR(500) NOT NULL,
    CreadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_A3Pendientes_Creado DEFAULT (SYSUTCDATETIME()),
    VistoUtc      DATETIME2(0) NOT NULL CONSTRAINT DF_A3Pendientes_Visto DEFAULT (SYSUTCDATETIME()),
    ResueltoUtc   DATETIME2(0) NULL,
    ResueltoPorId INT NULL CONSTRAINT FK_A3Pendientes_Resuelto REFERENCES fich.Usuarios(UsuarioId),
    Resolucion    VARCHAR(12) NULL CONSTRAINT CK_A3Pendientes_Resolucion CHECK (Resolucion IS NULL OR Resolucion IN ('AUTO','IGNORADO'))
);
GO
CREATE UNIQUE INDEX UX_A3Pendientes_Abiertos ON fich.A3Pendientes(Tipo, Clave) WHERE ResueltoUtc IS NULL;
GO

/* ---------- Sincronizaciones (peticiones e historial) ---------- */
CREATE TABLE fich.A3Sincronizaciones (
    SincronizacionId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_A3Sincronizaciones PRIMARY KEY,
    Tipo                 VARCHAR(10) NOT NULL CONSTRAINT CK_A3Sinc_Tipo CHECK (Tipo IN ('NOCTURNA','MANUAL')),
    Completa             BIT NOT NULL CONSTRAINT DF_A3Sinc_Completa DEFAULT (0),
    SolicitadaPorId      INT NULL CONSTRAINT FK_A3Sinc_Solicitada REFERENCES fich.Usuarios(UsuarioId),
    SolicitadaUtc        DATETIME2(0) NOT NULL CONSTRAINT DF_A3Sinc_Solicitada DEFAULT (SYSUTCDATETIME()),
    InicioUtc            DATETIME2(0) NULL,
    FinUtc               DATETIME2(0) NULL,
    Estado               VARCHAR(10) NOT NULL CONSTRAINT DF_A3Sinc_Estado DEFAULT ('PENDIENTE')
                         CONSTRAINT CK_A3Sinc_Estado CHECK (Estado IN ('PENDIENTE','EN_CURSO','OK','ERROR')),
    Llamadas             INT NOT NULL CONSTRAINT DF_A3Sinc_Llamadas DEFAULT (0),
    Empresas             INT NOT NULL CONSTRAINT DF_A3Sinc_Empresas DEFAULT (0),
    Centros              INT NOT NULL CONSTRAINT DF_A3Sinc_Centros DEFAULT (0),
    EmpleadosLeidos      INT NOT NULL CONSTRAINT DF_A3Sinc_Leidos DEFAULT (0),
    UsuariosCreados      INT NOT NULL CONSTRAINT DF_A3Sinc_Creados DEFAULT (0),
    UsuariosActualizados INT NOT NULL CONSTRAINT DF_A3Sinc_Actualizados DEFAULT (0),
    UsuariosDesactivados INT NOT NULL CONSTRAINT DF_A3Sinc_Desactivados DEFAULT (0),
    Pendientes           INT NOT NULL CONSTRAINT DF_A3Sinc_Pendientes DEFAULT (0),
    Error                NVARCHAR(1000) NULL
);
GO

/* ---------- Estado de la conexión (fila única; los secretos van en Key Vault) ---------- */
CREATE TABLE fich.A3Conexion (
    Id               TINYINT NOT NULL CONSTRAINT PK_A3Conexion PRIMARY KEY CONSTRAINT CK_A3Conexion_Id CHECK (Id = 1),
    ClientId         VARCHAR(100) NOT NULL,
    RedirectUri      VARCHAR(300) NULL,
    UrlRetornoApp    VARCHAR(300) NOT NULL,
    Estado           VARCHAR(12) NOT NULL CONSTRAINT DF_A3Conexion_Estado DEFAULT ('DESCONECTADA')
                     CONSTRAINT CK_A3Conexion_Estado CHECK (Estado IN ('DESCONECTADA','CONECTADA','CADUCADA','ERROR')),
    UsuarioA3        NVARCHAR(254) NULL,
    ConectadaUtc     DATETIME2(0) NULL,
    CaducaUtc        DATETIME2(0) NULL,
    ConectadaPorId   INT NULL CONSTRAINT FK_A3Conexion_Por REFERENCES fich.Usuarios(UsuarioId),
    OAuthState       VARCHAR(64) NULL,
    OAuthStateUtc    DATETIME2(0) NULL,
    OAuthPorId       INT NULL,
    UltimaSyncOkUtc  DATETIME2(0) NULL,
    MarcaEmpleados   DATE NULL,
    UltimoError      NVARCHAR(1000) NULL
);
GO
INSERT INTO fich.A3Conexion (Id, ClientId, UrlRetornoApp)
VALUES (1, 'WK.ES.API.a3innuvaNomina.96488.ITOPTRAINING', 'https://salmon-pebble-0a74a1503.3.azurestaticapps.net/admin/a3');
GO

/* ---------- Permisos de la API de la app (SWA) ---------- */
GRANT SELECT, UPDATE         ON fich.A3Empresas         TO app_fichajes;
GRANT SELECT, UPDATE         ON fich.A3Centros          TO app_fichajes;
GRANT SELECT                 ON fich.A3Empleados        TO app_fichajes;
GRANT SELECT                 ON fich.A3Organigrama      TO app_fichajes;
GRANT SELECT, UPDATE         ON fich.A3Pendientes       TO app_fichajes;
GRANT SELECT, INSERT         ON fich.A3Sincronizaciones TO app_fichajes;
GRANT SELECT, UPDATE         ON fich.A3Conexion         TO app_fichajes;
GO

/* =====================================================================
   BLOQUE FINAL - Ejecutar cuando exista la Function App func-a3sync-prod
   con identidad administrada activada (usuario de BD sin contraseña).
   ===================================================================== */
-- CREATE USER [func-a3sync-prod] FROM EXTERNAL PROVIDER;
-- GRANT SELECT, INSERT, UPDATE         ON fich.Empresas           TO [func-a3sync-prod];
-- GRANT SELECT                         ON fich.Centros            TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.Usuarios           TO [func-a3sync-prod];
-- GRANT INSERT                         ON fich.Auditoria          TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.A3Empresas         TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.A3Centros          TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.A3Empleados        TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fich.A3Organigrama      TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.A3Pendientes       TO [func-a3sync-prod];
-- GRANT SELECT, INSERT, UPDATE         ON fich.A3Sincronizaciones TO [func-a3sync-prod];
-- GRANT SELECT, UPDATE                 ON fich.A3Conexion         TO [func-a3sync-prod];
-- UPDATE fich.A3Conexion SET RedirectUri = 'https://<dominio de func-a3sync-prod>/api/a3/callback' WHERE Id = 1;
