/* =====================================================================
   013 - Ficha laboral de a3 en fich.A3Empleados
   - Del listado de trabajadores (sin llamadas extra): tipo de persona, grupo de tarifa, prácticas no remuneradas.
   - De /jobPositionInformation: puesto, departamento a3, unidad organizativa, responsable (manager), % jornada.
   - De /contract-agreement: contrato vigente (código y descripción), periodo y tipo de cotización. No se guarda salario.
   - FichaLeidaUtc: cuándo se leyó; los que están en alta sin ficha se completan en la siguiente sincronización.
   Ejecutar en sqldb-fichajes-prod. En el portal: 013_ficha_laboral_a3_portal.sql (sin GO).
   ===================================================================== */
ALTER TABLE fich.A3Empleados ADD
    TipoPersona        NVARCHAR(100) NULL,
    GrupoTarifa        INT           NULL,
    Practicas          BIT           NULL,
    PuestoCodigo       NVARCHAR(20)  NULL,
    Puesto             NVARCHAR(150) NULL,
    DepartamentoA3     NVARCHAR(150) NULL,
    UnidadOrganizativa NVARCHAR(150) NULL,
    ResponsableCodigo  NVARCHAR(20)  NULL,
    ResponsableNombre  NVARCHAR(200) NULL,
    Jornada            DECIMAL(7,2)  NULL,
    PuestoDesde        DATE          NULL,
    ContratoCodigo     NVARCHAR(10)  NULL,
    Contrato           NVARCHAR(200) NULL,
    ContratoDesde      DATE          NULL,
    ContratoHasta      DATE          NULL,
    TipoCotizacion     NVARCHAR(100) NULL,
    FichaLeidaUtc      DATETIME2(0)  NULL;
GO
CREATE INDEX IX_A3Empleados_Usuario ON fich.A3Empleados(UsuarioId) WHERE UsuarioId IS NOT NULL;
GO
SELECT COUNT(*) AS Empleados, COUNT(FichaLeidaUtc) AS ConFicha FROM fich.A3Empleados;
GO
