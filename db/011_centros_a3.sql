/* =====================================================================
   011 - Centros desde a3 (a3 es la fuente de centros/servicios)
   - fich.Centros.CodigoA3: «empresa a3-centro a3» (p. ej. 355-1), lo pone el conector.
     El código de servicio (CodigoServicio) sigue siendo manual.
   - Limpieza de los datos de prueba: centros, turnos y departamentos.
     Los usuarios se mantienen sin centro ni departamento.
   - Volcado de los centros ya leídos de a3 (fich.A3Centros) de las empresas importadas.
   - Permisos del conector (func-a3sync-prod) para crear y actualizar centros.
   Ejecutar en sqldb-fichajes-prod. En el portal: bloques sin GO (011_centros_a3_portal.sql).
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- 1. Código a3 del centro ---------- */
ALTER TABLE fich.Centros ADD CodigoA3 VARCHAR(20) NULL;
GO
CREATE UNIQUE INDEX UX_Centros_CodigoA3 ON fich.Centros(CodigoA3) WHERE CodigoA3 IS NOT NULL;
GO

/* ---------- 2. Permisos del conector ---------- */
GRANT SELECT, INSERT, UPDATE ON fich.Centros TO [func-a3sync-prod];
GO

/* ---------- 3. Limpieza de datos de prueba ---------- */
BEGIN TRAN;
UPDATE fich.HorarioTramos SET TurnoId = NULL WHERE TurnoId IS NOT NULL;
DELETE FROM fich.Turnos;
UPDATE fich.Usuarios SET CentroId = NULL, DepartamentoId = NULL WHERE CentroId IS NOT NULL OR DepartamentoId IS NOT NULL;
DELETE FROM fich.Departamentos;
UPDATE fich.A3Centros SET CentroId = NULL WHERE CentroId IS NOT NULL;
DELETE FROM fich.Centros;
COMMIT;
GO

/* ---------- 4. Volcado de centros de a3 (empresas con Importar = 1) ---------- */
DECLARE @e INT;
DECLARE emp CURSOR LOCAL FAST_FORWARD FOR SELECT CodigoA3 FROM fich.A3Empresas WHERE Importar = 1 AND EmpresaId IS NOT NULL;
OPEN emp;
FETCH NEXT FROM emp INTO @e;
WHILE @@FETCH_STATUS = 0
BEGIN
  DECLARE @emp INT = (SELECT EmpresaId FROM fich.A3Empresas WHERE CodigoA3 = @e);

  INSERT INTO fich.Centros (EmpresaId, Nombre, Direccion, CodigoPostal, Ciudad, Telefono, CodigoA3, EsEstructura)
  SELECT @emp,
         CASE WHEN COUNT(*) OVER (PARTITION BY LOWER(a.Nombre)) > 1
              THEN LEFT(a.Nombre, 135) + N' (' + CAST(a.EmpresaA3 AS NVARCHAR(10)) + N'-' + CAST(a.CentroA3 AS NVARCHAR(10)) + N')'
              ELSE a.Nombre END,
         a.Direccion,
         CASE WHEN a.CodigoPostal LIKE '[0-9][0-9][0-9][0-9][0-9]' THEN a.CodigoPostal END,
         a.Ciudad, LEFT(a.Telefono, 20),
         CAST(a.EmpresaA3 AS VARCHAR(10)) + '-' + CAST(a.CentroA3 AS VARCHAR(10)),
         CASE WHEN a.Nombre LIKE N'%ESTRUCTURA%' THEN 1 ELSE 0 END
    FROM fich.A3Centros a
   WHERE a.EmpresaA3 = @e AND a.Activo = 1;

  UPDATE a SET CentroId = c.CentroId
    FROM fich.A3Centros a
    JOIN fich.Centros c ON c.CodigoA3 = CAST(a.EmpresaA3 AS VARCHAR(10)) + '-' + CAST(a.CentroA3 AS VARCHAR(10))
   WHERE a.EmpresaA3 = @e;

  FETCH NEXT FROM emp INTO @e;
END
CLOSE emp;
DEALLOCATE emp;
GO

/* ---------- 5. Comprobación ---------- */
SELECT (SELECT COUNT(*) FROM fich.Centros)                                AS Centros,
       (SELECT COUNT(*) FROM fich.Centros WHERE EsEstructura = 1)         AS Estructura,
       (SELECT COUNT(*) FROM fich.A3Centros WHERE CentroId IS NOT NULL)   AS A3Enlazados,
       (SELECT COUNT(*) FROM fich.Departamentos)                          AS Departamentos,
       (SELECT COUNT(*) FROM fich.Turnos)                                 AS Turnos,
       (SELECT COUNT(*) FROM fich.Usuarios WHERE CentroId IS NOT NULL)    AS UsuariosConCentro;
GO
