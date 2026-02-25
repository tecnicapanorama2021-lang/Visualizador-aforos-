# Modelo de datos y convenciones — Aforos

Documenta la convención de **sentidos** y **clasificación vehicular** usada en la BD y en la API, y cómo se normalizan para la UI (IDU/INVIAS).

---

## 1. Fuente de verdad (Excel IDU)

- **Categorías vehiculares:** AUTOS | BUSES | CAMIONES | CAMIONES C3 | BICICLETAS | MOTOS | PEATONES  
- **Accesos:** NORTE | SUR | ORIENTE | OCCIDENTE  
- **Movimientos:** NORTE→SUR | SUR→NORTE | NORTE→ORIENTE | etc. (todo en español)

En la UI no se usa "Livianos" ni "L"; se usa **"Autos"**. El total vehicular (estándar IDU/INVIAS) es **Autos + Buses + Camiones + Motos**; Bicicletas y Peatones se muestran aparte como "No motorizados".

---

## 2. Sentidos en BD (`conteos_resumen.sentido`)

En la BD los sentidos pueden estar como **códigos cortos** (ej. `NS`, `SN`, `WN`, `NW`). La aplicación **no modifica la BD**; la normalización se hace en código al leer.

### Códigos típicos y mapeo a display

| Código BD | Display (español) |
|-----------|-------------------|
| NS | Norte → Sur |
| SN | Sur → Norte |
| EO, OE, WE, EW | Oriente ↔ Occidente |
| NW, NE, SW, SE | Giros Norte/Sur ↔ Oriente/Occidente |
| WN, WS, EN, ES, ON, OS | Giros Occidente/Oriente ↔ Norte/Sur |
| NN, SS, EE, OO, WW | Giros en U (ej. Norte → Norte) |
| N, S, E, O, W | Accesos simples (Norte, Sur, Oriente, Occidente) |

**W** se normaliza siempre a **Occidente** (no "Oeste"). **E** → **Oriente**.

Para verificar cobertura en tu BD:

```sql
SELECT DISTINCT sentido FROM conteos_resumen ORDER BY sentido;
```

Si aparece algún valor no listado arriba, añadirlo a `server/utils/normalizeSentido.js` (SENTIDO_MAP).

---

## 3. Clasificación vehicular en BD y API

- **Columnas en `conteos_resumen`:** `vol_autos`, `vol_motos`, `vol_buses`, `vol_pesados`, `vol_bicis`, `vol_otros`.
- **Etiquetas en la API/UI:** Autos (no Livianos), Motos, Buses, Camiones, Bicicletas, Otros. Opcional: Camiones C2/C3, Peatones si existen en el Excel.

El mapeo código → etiqueta está en `server/utils/normalizeClaseVehiculo.js` y en el front en `src/utils/classLabelMap.js`.

---

## 4. Dónde se aplica la normalización

| Lugar | Sentidos | Clases |
|-------|----------|--------|
| **GET /api/aforos/historial/:nodeId** | `normalizeSentido()` en `routes/aforos.js` al armar `distribucion_hora_pico` y `vol_data_completo` | `class_headers` con etiquetas desde `normalizeClaseVehiculo()` |
| **GET /api/aforos/analisis/:idEstudio** (Excel) | `normalizeSentido()` en `server/utils/aforoAnalisis.js` al armar `distribucion_hora_pico` y `vol_data_completo` | `class_headers` con `normalizeClaseVehiculo(k)` |
| **Frontend (ResumenAnalisisAforo)** | `normalizeSentidoLabel()` + "(giro en U)" si origen = destino | `getClassLabel()`; solo se muestran categorías con valor > 0; Total vehicular sin bici/peatones; línea "No motorizados" |

---

## 5. Opción B (no usada por defecto): migrar BD

Si en el futuro se quisiera tener los sentidos ya normalizados en la BD:

- Crear migración `027_normalizar_sentidos.sql` que haga `UPDATE conteos_resumen SET sentido = <mapeo> WHERE sentido IN (...)`.
- La aplicación podría seguir aplicando `normalizeSentido()` como passthrough para valores ya en español.

**Recomendación:** mantener **Opción A** (normalizar solo en código) para no tocar datos crudos y poder ajustar el mapeo sin migraciones.
