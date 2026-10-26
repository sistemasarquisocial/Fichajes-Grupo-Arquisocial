/* =====================================================================
   Script 003 - Ubicación del fichaje (opcional, solo en el instante de fichar)
   - Columnas nulas: los fichajes anteriores quedan intactos (tabla LEDGER).
   - UbicacionEstado: OK | DENEGADA | NO_DISPONIBLE | TIMEOUT | NO_SOPORTADA
   Ejecutar en sqldb-fichajes-test y sqldb-fichajes-prod ANTES de desplegar la API.
   ===================================================================== */
ALTER TABLE fich.Fichajes ADD
    Latitud         DECIMAL(9,6) NULL,
    Longitud        DECIMAL(9,6) NULL,
    PrecisionM      INT          NULL,
    UbicacionEstado VARCHAR(20)  NULL;
