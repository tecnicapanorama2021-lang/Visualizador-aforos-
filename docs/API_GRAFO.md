# API Grafo (legs, turns, baseline, simulación)

Base URL: `/api/grafo` y `/api/simular`. El `nodeId` puede ser `node_id_externo` (ej. `"171"`) o nombre/dirección; se resuelve a `nodos.id` internamente.

## Estándar de timebucket y zona horaria

- **Formato:** `weekday_HH:MM` o `weekend_HH:MM` (slot de 15 minutos). Ejemplos: `weekday_07:00`, `weekday_07:15`, `weekend_08:00`.
- **Zona horaria:** Los buckets se calculan en **hora local Bogotá** (`America/Bogota`). En BD, `conteos_resumen.intervalo_ini` / `intervalo_fin` son `TIMESTAMPTZ`; el script de baseline convierte a local para obtener día de la semana y hora.
- **Semana:** `weekday` = lunes a viernes (DOW 1–5 en PostgreSQL); `weekend` = sábado y domingo.

---

## GET /api/grafo/nodos/:nodeId/legs

Devuelve las ramas (legs) del nodo.

**Respuesta:**
```json
{
  "node_id": 123,
  "legs": [
    { "leg_code": "N", "bearing_deg": null, "meta": null },
    { "leg_code": "S", "bearing_deg": null, "meta": null }
  ]
}
```

---

## GET /api/grafo/nodos/:nodeId/turns

Devuelve los giros (from_leg → to_leg) para el nodo. Opcional: `?bucket=weekday_07:00`.

**Respuesta:**
```json
{
  "node_id": 123,
  "timebucket": "weekday_07:00",
  "turns": [
    {
      "from_leg_code": "N",
      "to_leg_code": "N",
      "flow_total": 450,
      "p_turn": 1,
      "quality": { "low_confidence": true, "reason": "solo_sentido" }
    }
  ]
}
```

---

## GET /api/grafo/nodos/:nodeId/baseline

Resumen: buckets disponibles y top turns por flujo.

**Respuesta:**
```json
{
  "node_id": 123,
  "timebuckets": ["weekday_07:00", "weekday_07:15", "..."],
  "top_turns": [
    { "from_leg_code": "N", "to_leg_code": "N", "timebucket": "weekday_07:00", "flow_total": 450, "p_turn": 1 }
  ]
}
```

---

## POST /api/simular/cierre-giro

Simula el cierre de un giro y devuelve redistribución (determinístico).

**Body:**
```json
{
  "node_id": 123,
  "from_leg": "N",
  "to_leg": "S",
  "bucket": "weekday_07:00",
  "closure": true
}
```

**Respuesta:**
```json
{
  "node_id": 123,
  "timebucket": "weekday_07:00",
  "closure": true,
  "before": [ { "from_leg_code": "N", "to_leg_code": "S", "flow_total": 100 }, "..." ],
  "after": [ { "from_leg_code": "N", "to_leg_code": "S", "flow_total_before": 100, "flow_total_after": 0 }, "..." ],
  "delta": { "closed_flow": 100, "redistributed": 100 }
}
```

El flujo del giro cerrado se redistribuye a los demás giros desde el mismo `from_leg` en proporción a su `p_turn`.

**Sin turns de baseline (409):** Si no hay filas en `node_turns` para ese nodo y bucket (por ejemplo solo hay `node_legs` porque no hay estudios con movimiento), el endpoint responde **409** con:

```json
{
  "code": "NO_TURNS_BASELINE",
  "message": "No hay turns de baseline para este nodo y bucket (solo hay node_legs o el nodo no tiene datos con movimiento).",
  "node_id": 123,
  "timebucket": "weekday_07:00"
}
```
