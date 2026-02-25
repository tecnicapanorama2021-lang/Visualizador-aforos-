# Eventos Bogotá 2026 — Import manual (JSON)

Flujo para crear **eventos canónicos** en incidentes (geom + start_at + end_at) a partir de un JSON manual, usando los **LUGAR_EVENTO** ya existentes en BD para georreferenciar. No se mezcla con Agéndate viejo ni se toca el predictor.

## Dónde va el archivo

- **Origen:** descargar/copiar el JSON a la carpeta del proyecto.
- **Destino:** `public/data/eventos_bogota_2026_completo.json`

El script de copia puede llevar el archivo desde **Descargas** a esa ruta (ver comandos abajo).

Estructura esperada del JSON:

```json
{
  "source": "...",
  "exportedAt": "...",
  "events": [
    {
      "titulo": "...",
      "fecha_inicio": "YYYY-MM-DD",
      "fecha_fin": "YYYY-MM-DD",
      "hora_inicio": "HH:mm",
      "lugar_nombre": "...",
      "direccion": "...",
      "tipo_evento": "...",
      "estimacion_afluencia": "...",
      "enlace_fuente": "...",
      "fuente": "..."
    }
  ]
}
```

## Comandos (orden recomendado)

1. **Copiar JSON desde Descargas a `public/data`**
   ```bash
   npm run import:eventos:bogota:copy
   ```

2. **Importar a contexto_eventos (dry-run por defecto)**
   ```bash
   npm run import:eventos:bogota:contexto:dry
   ```
   Para escribir en BD:
   ```bash
   npm run import:eventos:bogota:contexto:apply
   ```

3. **Crear incidentes canónicos (eventos con geom + fechas)**
   ```bash
   npm run ingest:eventos:incidentes -- --apply
   ```

4. **Verificación del flujo**
   ```bash
   npm run verify:eventos:bogota
   ```

## Flujo de prueba (recomendado)

1. `npm run import:eventos:bogota:copy`
2. `npm run import:eventos:bogota:contexto:apply`
3. `npm run ingest:eventos:incidentes -- --apply`
4. `npm run verify:eventos:bogota`
5. En la UI: **Vigencia = Activos**, **Eventos = Próximos 7 días** → deben verse eventos si `upcoming7 > 0`.

## Notas

- **LUGAR_EVENTO** no se borra ni se re-ingesta; los lugares ya están en BD. El import solo hace *match* por nombre (exacto o contains) para asignar geom a cada evento.
- Si **“Activos ahora”** da 0, revisar **“Próximos 7 días”** en el mapa; las fechas pueden caer en esa ventana.
- Variables de entorno opcionales para el import:
  - `EVENTOS_BOGOTA_DEFAULT_DURACION_H` (default: 3)
  - `EVENTOS_BOGOTA_FUENTE` (default: `BOGOTA_GOV_MANUAL_2026`)
  - `EVENTOS_BOGOTA_SRID` (default: 4326)
