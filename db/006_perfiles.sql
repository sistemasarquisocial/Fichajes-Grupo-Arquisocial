/* =====================================================================
   Script 006 - Perfiles, departamentos, cadena de aprobación y suplencias
   Perfiles:
     - ESTRUCTURA: pertenece a un departamento. Le aprueba el manager del departamento.
       Si él es manager de algún departamento (o no tiene departamento), le aprueba
       el manager asignado en su ficha (Usuarios.ManagerId). La CEO no tiene manager.
     - DELEGACION: pertenece a un centro. Le aprueba el coordinador del centro.
       Al coordinador le aprueba el gestor de sus centros.
   El puesto (coordinador, gestor, manager...) se deduce de las asignaciones.
   Los roles quedan como permisos: EMPLEADO, RRHH, ADMIN.
   Ejecutar en sqldb-fichajes-prod ANTES de fusionar el PR que lo usa.
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- Roles: solo permisos (RESPONSABLE pasa a EMPLEADO) ---------- */
UPDATE fich.Usuarios SET Rol = 'EMPLEADO' WHERE Rol = 'RESPONSABLE';
GO
ALTER TABLE fich.Usuarios DROP CONSTRAINT CK_Usuarios_Rol;
GO
ALTER TABLE fich.Usuarios ADD CONSTRAINT CK_Usuarios_Rol CHECK (Rol IN ('EMPLEADO','RRHH','ADMIN'));
GO

/* ---------- Departamentos ---------- */
CREATE TABLE fich.Departamentos (
    DepartamentoId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Departamentos PRIMARY KEY,
    Nombre         NVARCHAR(100) NOT NULL CONSTRAINT UQ_Departamentos_Nombre UNIQUE,
    ManagerId      INT NULL CONSTRAINT FK_Departamentos_Manager REFERENCES fich.Usuarios(UsuarioId),
    Activo         BIT NOT NULL CONSTRAINT DF_Departamentos_Activo DEFAULT (1),
    CreadoUtc      DATETIME2(0) NOT NULL CONSTRAINT DF_Departamentos_Creado DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Perfil de cada usuario ---------- */
ALTER TABLE fich.Usuarios ADD
    TipoPerfil     VARCHAR(12) NULL,
    DepartamentoId INT NULL CONSTRAINT FK_Usuarios_Departamento REFERENCES fich.Departamentos(DepartamentoId),
    ManagerId      INT NULL CONSTRAINT FK_Usuarios_Manager REFERENCES fich.Usuarios(UsuarioId);
GO
ALTER TABLE fich.Usuarios ADD CONSTRAINT CK_Usuarios_TipoPerfil
    CHECK (TipoPerfil IS NULL OR TipoPerfil IN ('ESTRUCTURA','DELEGACION'));
GO

/* ---------- Coordinador y gestor de cada centro ---------- */
ALTER TABLE fich.Centros ADD
    CoordinadorId INT NULL CONSTRAINT FK_Centros_Coordinador REFERENCES fich.Usuarios(UsuarioId),
    GestorId      INT NULL CONSTRAINT FK_Centros_Gestor REFERENCES fich.Usuarios(UsuarioId);
GO

/* ---------- Suplencias (vacaciones / ausencias del aprobador) ---------- */
CREATE TABLE fich.Suplencias (
    SuplenciaId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Suplencias PRIMARY KEY,
    TitularId    INT NOT NULL CONSTRAINT FK_Suplencias_Titular  REFERENCES fich.Usuarios(UsuarioId),
    SuplenteId   INT NOT NULL CONSTRAINT FK_Suplencias_Suplente REFERENCES fich.Usuarios(UsuarioId),
    Desde        DATE NOT NULL,
    Hasta        DATE NOT NULL,
    CreadoPorId  INT NOT NULL CONSTRAINT FK_Suplencias_CreadoPor REFERENCES fich.Usuarios(UsuarioId),
    CreadoUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Suplencias_Creado DEFAULT (SYSUTCDATETIME()),
    AnuladaUtc   DATETIME2(0) NULL,
    CONSTRAINT CK_Suplencias_Fechas CHECK (Hasta >= Desde),
    CONSTRAINT CK_Suplencias_Distintos CHECK (TitularId <> SuplenteId)
);
GO
CREATE INDEX IX_Suplencias_Titular ON fich.Suplencias(TitularId, Hasta);
CREATE INDEX IX_Suplencias_Suplente ON fich.Suplencias(SuplenteId, Hasta);
GO

/* ---------- Permisos de la API (todos los cambios quedan en fich.Auditoria) ---------- */
GRANT SELECT, INSERT, UPDATE ON fich.Departamentos TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Suplencias    TO app_fichajes;
GO

/* ---------- Comprobación ---------- */
SELECT Rol, COUNT(*) AS Usuarios FROM fich.Usuarios GROUP BY Rol;
