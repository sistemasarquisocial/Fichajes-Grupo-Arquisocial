import { BlobServiceClient, BlobSASPermissions } from "@azure/storage-blob";
import { createHash, randomUUID } from "node:crypto";

/* Almacenamiento de documentos en Azure Blob Storage (cuenta stfichajesprodneu).
   - Contenedores privados: "justificantes" y "nominas". Se borran solos a los 18 meses (regla de ciclo de vida).
   - Solo la API accede: sube los archivos y, tras comprobar permisos, da un enlace de lectura que caduca en 5 minutos.
   - Cadena de conexión en la variable STORAGE_CONNECTION_STRING. */

export type Contenedor = "justificantes" | "nominas";
export const MAX_BYTES = 10 * 1024 * 1024;
const MINUTOS_ENLACE = 5;

let cliente: BlobServiceClient | null = null;
function servicio(): BlobServiceClient {
  if (!cliente) {
    const cs = process.env.STORAGE_CONNECTION_STRING;
    if (!cs) throw new Error("Falta STORAGE_CONNECTION_STRING");
    cliente = BlobServiceClient.fromConnectionString(cs);
  }
  return cliente;
}
export const almacenConfigurado = () => !!process.env.STORAGE_CONNECTION_STRING;

/** Tipo real del archivo por su firma (no se confía en la extensión ni en lo que diga el navegador). */
export function tipoArchivo(b: Buffer): { mime: string; ext: string } | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  return null;
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Nombre de archivo seguro para mostrar y descargar. */
export function nombreSeguro(n: string | null | undefined, ext: string): string {
  const base = (n ?? "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
  if (!base) return `justificante.${ext}`;
  return base.toLowerCase().endsWith(`.${ext}`) || (ext === "jpg" && /\.jpe?g$/i.test(base)) ? base : `${base}.${ext}`;
}

export async function subir(contenedor: Contenedor, prefijo: string, datos: Buffer, mime: string, ext: string): Promise<string> {
  const ruta = `${prefijo}/${randomUUID()}.${ext}`;
  const blob = servicio().getContainerClient(contenedor).getBlockBlobClient(ruta);
  await blob.uploadData(datos, { blobHTTPHeaders: { blobContentType: mime } });
  return ruta;
}

export async function borrar(contenedor: Contenedor, ruta: string): Promise<void> {
  await servicio().getContainerClient(contenedor).getBlobClient(ruta).deleteIfExists();
}

export async function existe(contenedor: Contenedor, ruta: string): Promise<boolean> {
  return servicio().getContainerClient(contenedor).getBlobClient(ruta).exists();
}

/** Enlace de solo lectura que caduca en 5 minutos. */
export async function enlaceLectura(contenedor: Contenedor, ruta: string, nombre: string): Promise<string> {
  const blob = servicio().getContainerClient(contenedor).getBlobClient(ruta);
  const ahora = Date.now();
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    startsOn: new Date(ahora - 60000),
    expiresOn: new Date(ahora + MINUTOS_ENLACE * 60000),
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
  });
}
