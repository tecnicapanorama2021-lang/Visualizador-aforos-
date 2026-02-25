# Estudios propios (Panorama) – CSV estándar

Carga recurrente de estudios de tránsito propios en formato **CSV estándar**, sin modificar el ETL ni el frontend.

---

## 1. Formato del CSV estándar

El mismo formato que usan SECOP y CGT. Columnas:

| Columna         | Tipo   | Obligatorio | Descripción |
|-----------------|--------|-------------|-------------|
| archivo_nombre  | texto  | no          | Identificador del archivo. |
| origen          | texto  | no          | **Recomendado: `PANORAMA`** para estudios propios. Por defecto el ETL usa `EXTERNO`. |
| nodo_nombre     | texto  | sí          | Nombre o etiqueta del punto. |
| direccion       | texto  | sí          | Dirección o intersección (ej. "CALLE 80 X NQS"). |
| fecha           | texto  | sí          | **YYYY-MM-DD**. |
| sentido         | texto  | sí          | NS, SN, EO, OE. |
| hora_inicio     | texto  | sí          | **HH:MM** (24 h). |
| hora_fin        | texto  | sí          | **HH:MM** (24 h). |
| vol_total       | entero | sí          | Volumen total del intervalo. |
| vol_livianos    | entero | no          | Livianos/autos. |
| vol_motos       | entero | no          | Motos. |
| vol_buses       | entero | no          | Buses. |
| vol_pesados     | entero | no          | Pesados. |
| vol_bicis       | entero | no          | Bicicletas. |

Opcional: columnas `lat` y `lng` para asignar coordenadas al nodo al crearlo.

---

## 2. Ejemplo de CSV (estudios Panorama)

```csv
archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis
estudio_calle_80_2025.csv,PANORAMA,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,NS,07:00,07:15,98,65,18,4,8,3
estudio_calle_80_2025.csv,PANORAMA,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,NS,07:15,07:30,112,72,22,5,10,3
estudio_calle_80_2025.csv,PANORAMA,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,SN,07:00,07:15,85,58,15,3,7,2
```

---

## 3. Comando para cargar un estudio propio

```bash
node server/scripts/etl_fuente_externa_csv.js --path=ruta/a/tu_archivo.csv
```

Ejemplo con ruta relativa al proyecto:

```bash
node server/scripts/etl_fuente_externa_csv.js --path=server/scripts/data/estudio_panorama_2025.csv
```

El ETL:

1. Registra el archivo en `archivos_fuente` con `origen = 'PANORAMA'` (si la columna `origen` del CSV tiene ese valor).
2. Crea o reutiliza nodos (fuente EXTERNO) por dirección.
3. Crea estudios y conteos en `conteos_resumen`.
4. Marca el archivo como procesado.

Idempotencia: mismo contenido (mismo hash) reutiliza el mismo `archivos_fuente`; no duplica estudios ni conteos.

---

## 4. Registrar en archivos_fuente con origen PANORAMA

Si quieres **prerregistrar** el archivo en `archivos_fuente` con `origen = 'PANORAMA'` antes de ejecutar el ETL (por trazabilidad), puedes insertar a mano y luego **no** usar el ETL con ese archivo como entrada estándar, porque el ETL CSV **crea** el registro en `archivos_fuente` al cargar (con el origen tomado del CSV). Por tanto, la práctica recomendada es:

- Incluir en el CSV la columna **origen** con valor **PANORAMA**.
- Ejecutar solo: `node server/scripts/etl_fuente_externa_csv.js --path=...`

Así el registro en `archivos_fuente` quedará con `origen = 'PANORAMA'` y las estadísticas por fuente (`npm run stats:fuentes`) mostrarán correctamente estudios y conteos Panorama.
