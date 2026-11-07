/* =====================================================================
   012 - Técnico de RRHH de cada centro
   - fich.Centros.TecnicoRrhhId: persona de RRHH de referencia del centro
     (junto a CoordinadorId y GestorId). Solo asignación; no aprueba.
   Ejecutar en sqldb-fichajes-prod ANTES de desplegar la web/API que lo usa.
   En el portal: 012_centros_rrhh_portal.sql (bloques sin GO).
   ===================================================================== */
ALTER TABLE fich.Centros ADD TecnicoRrhhId INT NULL
    CONSTRAINT FK_Centros_TecnicoRrhh REFERENCES fich.Usuarios(UsuarioId);
GO

SELECT COUNT(*) AS Centros, COUNT(TecnicoRrhhId) AS ConTecnicoRrhh FROM fich.Centros;
GO
