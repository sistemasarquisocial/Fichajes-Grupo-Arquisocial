/* =====================================================================
   Script 008 - Calendarios, horarios, saldo y bolsa de horas
   - Centros: parámetros de control (margen de cortesía, escalado, sobrecarga, salida sin fichar).
     La comunidad sale del código postal y el municipio del campo Ciudad (no hay columnas nuevas).
   - Usuarios de ESTRUCTURA pueden tener centro (sede): solo para calendario y parámetros;
     su aprobador sigue siendo el manager del departamento.
   - fich.FestivosManuales: festivos locales por municipio y correcciones de los automáticos.
   - fich.Turnos: plantillas de turno por centro.
   - fich.Horarios / fich.HorarioTramos: horario FIJO, ROTATIVO (N semanas) o VARIABLE (horas/mes).
   - fich.CambiosDia: cambio puntual de un día (cambio de turno o día libre).
   - fich.AjustesMes: horas objetivo de un mes concreto (vacaciones, bajas... hasta que exista ese módulo).
   - fich.CierresMes: saldo y bolsa de cada mes cerrado (la bolsa se arrastra sin límite).
   El editor de consultas del portal no admite GO: usar la versión por bloques.
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- Parámetros de control por centro ---------- */
ALTER TABLE fich.Centros ADD
    MargenMinutos          INT NOT NULL CONSTRAINT DF_Centros_Margen DEFAULT (10),
    EscaladoMinutos        INT NOT NULL CONSTRAINT DF_Centros_Escalado DEFAULT (30),
    UmbralSobrecargaHoras  INT NOT NULL CONSTRAINT DF_Centros_Umbral DEFAULT (10),
    MaxHorasSinSalida      INT NOT NULL CONSTRAINT DF_Centros_MaxSinSalida DEFAULT (12);
GO
ALTER TABLE fich.Centros ADD CONSTRAINT CK_Centros_Parametros CHECK (
    MargenMinutos BETWEEN 0 AND 240 AND EscaladoMinutos BETWEEN 0 AND 480 AND
    UmbralSobrecargaHoras BETWEEN 0 AND 200 AND MaxHorasSinSalida BETWEEN 1 AND 24);
GO

/* ---------- Festivos manuales (locales y correcciones) ---------- */
CREATE TABLE fich.FestivosManuales (
    FestivoId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FestivosManuales PRIMARY KEY,
    Fecha         DATE NOT NULL,
    Nombre        NVARCHAR(100) NOT NULL,
    Ambito        VARCHAR(10) NOT NULL,          -- MUNICIPIO o COMUNIDAD
    Provincia     CHAR(2) NULL,                  -- 2 primeros dígitos del CP (MUNICIPIO)
    Municipio     NVARCHAR(100) NULL,            -- normalizado en mayúsculas sin tildes (MUNICIPIO)
    Comunidad     CHAR(2) NULL,                  -- código ISO: AR, MD... (COMUNIDAD)
    Quitar        BIT NOT NULL CONSTRAINT DF_Festivos_Quitar DEFAULT (0), -- 1 = anula un festivo automático
    CreadoPorId   INT NOT NULL CONSTRAINT FK_Festivos_CreadoPor REFERENCES fich.Usuarios(UsuarioId),
    CreadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_Festivos_Creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Festivos_Ambito CHECK (
        (Ambito = 'MUNICIPIO' AND Provincia IS NOT NULL AND Municipio IS NOT NULL AND Comunidad IS NULL) OR
        (Ambito = 'COMUNIDAD' AND Comunidad IS NOT NULL AND Provincia IS NULL AND Municipio IS NULL))
);
GO
CREATE INDEX IX_Festivos_Fecha ON fich.FestivosManuales(Fecha);
GO

/* ---------- Plantillas de turno por centro ---------- */
CREATE TABLE fich.Turnos (
    TurnoId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Turnos PRIMARY KEY,
    CentroId    INT NOT NULL CONSTRAINT FK_Turnos_Centro REFERENCES fich.Centros(CentroId),
    Nombre      NVARCHAR(50) NOT NULL,
    HoraInicio  TIME(0) NOT NULL,
    HoraFin     TIME(0) NOT NULL,               -- si es <= inicio, termina al día siguiente
    Activo      BIT NOT NULL CONSTRAINT DF_Turnos_Activo DEFAULT (1),
    CreadoUtc   DATETIME2(0) NOT NULL CONSTRAINT DF_Turnos_Creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Turnos_Nombre UNIQUE (CentroId, Nombre)
);
GO

/* ---------- Horario de cada trabajador ---------- */
CREATE TABLE fich.Horarios (
    UsuarioId        INT NOT NULL CONSTRAINT PK_Horarios PRIMARY KEY CONSTRAINT FK_Horarios_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Tipo             VARCHAR(10) NOT NULL,
    HorasMes         DECIMAL(6,2) NULL,         -- VARIABLE
    Semanas          TINYINT NOT NULL CONSTRAINT DF_Horarios_Semanas DEFAULT (1), -- ROTATIVO: nº de semanas del patrón
    InicioPatron     DATE NULL,                 -- ROTATIVO: lunes en que empieza la semana 1
    BolsaDesde       CHAR(7) NULL,              -- VARIABLE: primer mes (YYYY-MM) que cuenta para la bolsa
    DescuentaFestivos BIT NOT NULL CONSTRAINT DF_Horarios_Festivos DEFAULT (1), -- FIJO/ROTATIVO: los festivos no se trabajan
    ModificadoPorId  INT NOT NULL CONSTRAINT FK_Horarios_ModificadoPor REFERENCES fich.Usuarios(UsuarioId),
    ModificadoUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Horarios_Modificado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Horarios_Tipo CHECK (Tipo IN ('FIJO','ROTATIVO','VARIABLE')),
    CONSTRAINT CK_Horarios_Datos CHECK (
        (Tipo = 'VARIABLE' AND HorasMes IS NOT NULL AND HorasMes BETWEEN 0 AND 400) OR
        (Tipo = 'FIJO' AND Semanas = 1) OR
        (Tipo = 'ROTATIVO' AND Semanas BETWEEN 1 AND 8 AND InicioPatron IS NOT NULL))
);
GO

/* Tramos del patrón: semana (1..N), día (1 = lunes ... 7 = domingo), varios tramos por día */
CREATE TABLE fich.HorarioTramos (
    TramoId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HorarioTramos PRIMARY KEY,
    UsuarioId   INT NOT NULL CONSTRAINT FK_Tramos_Horario REFERENCES fich.Horarios(UsuarioId),
    Semana      TINYINT NOT NULL,
    DiaSemana   TINYINT NOT NULL,
    HoraInicio  TIME(0) NOT NULL,
    HoraFin     TIME(0) NOT NULL,
    TurnoId     INT NULL CONSTRAINT FK_Tramos_Turno REFERENCES fich.Turnos(TurnoId),
    CONSTRAINT CK_Tramos CHECK (Semana BETWEEN 1 AND 8 AND DiaSemana BETWEEN 1 AND 7)
);
GO
CREATE INDEX IX_Tramos_Usuario ON fich.HorarioTramos(UsuarioId, Semana, DiaSemana);
GO

/* Cambio puntual de un día: sustituye el plan de esa fecha. Sin tramos (HoraInicio NULL) = día libre. */
CREATE TABLE fich.CambiosDia (
    CambioId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CambiosDia PRIMARY KEY,
    UsuarioId    INT NOT NULL CONSTRAINT FK_Cambios_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Fecha        DATE NOT NULL,
    HoraInicio   TIME(0) NULL,
    HoraFin      TIME(0) NULL,
    CreadoPorId  INT NOT NULL CONSTRAINT FK_Cambios_CreadoPor REFERENCES fich.Usuarios(UsuarioId),
    CreadoUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Cambios_Creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Cambios CHECK ((HoraInicio IS NULL AND HoraFin IS NULL) OR (HoraInicio IS NOT NULL AND HoraFin IS NOT NULL))
);
GO
CREATE INDEX IX_Cambios_Usuario ON fich.CambiosDia(UsuarioId, Fecha);
GO

/* Horas objetivo de un mes concreto (sustituye al cálculo automático o a HorasMes) */
CREATE TABLE fich.AjustesMes (
    UsuarioId     INT NOT NULL CONSTRAINT FK_Ajustes_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Mes           CHAR(7) NOT NULL,
    Horas         DECIMAL(6,2) NOT NULL,
    Motivo        NVARCHAR(200) NOT NULL,
    CreadoPorId   INT NOT NULL CONSTRAINT FK_Ajustes_CreadoPor REFERENCES fich.Usuarios(UsuarioId),
    CreadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_Ajustes_Creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_AjustesMes PRIMARY KEY (UsuarioId, Mes),
    CONSTRAINT CK_Ajustes CHECK (Horas BETWEEN 0 AND 400)
);
GO

/* Cierre de cada mes ya terminado: objetivo, trabajado y bolsa acumulada al cierre (minutos) */
CREATE TABLE fich.CierresMes (
    UsuarioId          INT NOT NULL CONSTRAINT FK_Cierres_Usuario REFERENCES fich.Usuarios(UsuarioId),
    Mes                CHAR(7) NOT NULL,
    Tipo               VARCHAR(10) NOT NULL,
    MinutosObjetivo    INT NOT NULL,
    MinutosTrabajados  INT NOT NULL,
    BolsaMinutos       INT NOT NULL,             -- deuda acumulada al cierre (>= 0)
    CerradoUtc         DATETIME2(0) NOT NULL CONSTRAINT DF_Cierres_Cerrado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_CierresMes PRIMARY KEY (UsuarioId, Mes)
);
GO

/* ---------- Permisos de la API ---------- */
GRANT SELECT, INSERT, DELETE ON fich.FestivosManuales TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Turnos           TO app_fichajes;
GRANT SELECT, INSERT, UPDATE, DELETE ON fich.Horarios      TO app_fichajes;
GRANT SELECT, INSERT, DELETE ON fich.HorarioTramos    TO app_fichajes;
GRANT SELECT, INSERT, DELETE ON fich.CambiosDia       TO app_fichajes;
GRANT SELECT, INSERT, UPDATE, DELETE ON fich.AjustesMes    TO app_fichajes;
GRANT SELECT, INSERT         ON fich.CierresMes       TO app_fichajes;
GO

SELECT 'Script 008 aplicado' AS Resultado;
