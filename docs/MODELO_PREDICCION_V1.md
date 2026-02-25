# Modelo de predicción de aforos — baseline_v1

## Fórmula

```
prediccion = promedio_historico(nodo, DOW, hora) × (1 + impacto_total)
```

```
impacto_total = Σ [ factor_tipo(incidente) × factor_distancia(distancia_m) ]
factor_distancia = 1 - (distancia_m / radio_m)   [lineal, 0 a 1]
```

## Factores por tipo de incidente

| Tipo          | Factor |
|---------------|--------|
| OBRA          | -0.15  |
| EVENTO        | +0.25  |
| MANIFESTACION | -0.20  |

## Confianza

| Condición        | Nivel  |
|------------------|--------|
| n_estudios > 10  | alta   |
| n_estudios 4–10  | media  |
| n_estudios ≤ 3   | baja   |

## Festivos (Colombia)

Si la fecha consultada es festivo (tabla `festivos_colombia`):

- Se usa el patrón histórico de **domingos** (DOW = 0) para el promedio.
- Si no hay suficientes muestras festivas, se aplica `factor_festivo = 0.7` al promedio de cualquier día.

## Limitaciones conocidas (baseline_v1)

- No considera estacionalidad mensual.
- No considera clima.
- No considera festivos nacionales/distritales más allá del ajuste por DOW festivo.
- Incidentes sin `end_at` no tienen impacto temporal acotado.
- Radio fijo (500 m por defecto) no considera topología vial.

## Métricas de referencia en tráfico urbano [literatura]

- MAPE aceptable para baseline histórico: **15–25%**.
- Modelos LSTM/GCN avanzados suelen lograr **6–10%**.
- Fuente: literatura de predicción de flujo urbano.

## Próximas mejoras sugeridas (v2)

1. **Festivos**: tabla `festivos_colombia` ya integrada; ampliar años y tipos (puente).
2. **Clima**: API OpenWeatherMap o IDEAM (lluvia → -10 a -20%).
3. **Corredor**: propagar impacto por grafo vial (no solo radio).
4. **Series de tiempo**: ARIMA/SARIMA por nodo cuando haya >50 muestras.
