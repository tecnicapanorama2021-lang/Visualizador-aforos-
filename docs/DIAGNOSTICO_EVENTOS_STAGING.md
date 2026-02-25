# Diagnóstico: eventos en staging vs incidentes (mapa)

El mapa usa **incidentes** como fuente; **contexto_eventos** es staging. Si hay muchos en staging y pocos en el mapa, ejecutar en pgAdmin los siguientes queries y pegar los resultados en el PR.

---

## 1. ¿Cuántos EVENTO_CULTURAL tienen geom pero sin start_at?

```sql
SELECT COUNT(*) AS con_geom_sin_fecha
FROM contexto_eventos
WHERE tipo = 'EVENTO_CULTURAL'
  AND geom IS NOT NULL
  AND (fecha_inicio IS NULL OR fecha_inicio = '');
```

**Resultado (pegar aquí):** `con_geom_sin_fecha = ___`

---

## 2. ¿Cuántos EVENTO_CULTURAL no tienen geom?

```sql
SELECT COUNT(*) AS sin_geom
FROM contexto_eventos
WHERE tipo = 'EVENTO_CULTURAL'
  AND geom IS NULL;
```

**Resultado (pegar aquí):** `sin_geom = ___`

---

## 3. ¿Cuántos EVENTO_CULTURAL están listos para pasar a incidentes?

```sql
SELECT COUNT(*) AS listos
FROM contexto_eventos
WHERE tipo = 'EVENTO_CULTURAL'
  AND geom IS NOT NULL
  AND fecha_inicio IS NOT NULL;
```

**Resultado (pegar aquí):** `listos = ___`

---

Interpretación: si staging tiene 93 y el mapa solo 1–3, la diferencia suele ser que en staging faltan **geom** (venue_matcher no encontró match) o **fecha_inicio** (p. ej. Agéndate sin horario). No corregir la BD en este PR; solo documentar el hallazgo.
