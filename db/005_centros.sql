/* =====================================================================
   Script 005 - Datos de los centros de trabajo
   - CodigoServicio: numérico (solo dígitos, máx. 10), único en todo el grupo.
     Se guarda como texto para conservar ceros a la izquierda.
     La app lo exige en altas; los centros ya existentes quedan sin código
     hasta que se editen.
   - Direccion, CodigoPostal, Ciudad, Telefono: opcionales.
   Ejecutar en sqldb-fichajes-test y sqldb-fichajes-prod.
   ===================================================================== */
ALTER TABLE fich.Centros ADD
    CodigoServicio VARCHAR(10)   NULL,
    Direccion      NVARCHAR(200) NULL,
    CodigoPostal   VARCHAR(5)    NULL,
    Ciudad         NVARCHAR(100) NULL,
    Telefono       VARCHAR(20)   NULL;
GO

ALTER TABLE fich.Centros ADD CONSTRAINT CK_Centros_CodigoServicio
    CHECK (CodigoServicio IS NULL OR (LEN(CodigoServicio) BETWEEN 1 AND 10 AND CodigoServicio NOT LIKE '%[^0-9]%'));
GO

CREATE UNIQUE INDEX UX_Centros_CodigoServicio ON fich.Centros(CodigoServicio) WHERE CodigoServicio IS NOT NULL;
GO
