import { mean, meanAbsoluteError, smaForecast, holtForecast, linearRegressionForecast } from './forecastModels';
import type { ForecastConfidence, ForecastModelId, ModelPredictFn } from './forecastTypes';

const CANDIDATES: Array<{ id: ForecastModelId; predict: ModelPredictFn }> = [
  { id: 'sma', predict: smaForecast },
  { id: 'holt', predict: holtForecast },
  { id: 'linear', predict: linearRegressionForecast },
];

export interface ModelSelection {
  model: ForecastModelId;
  predict: ModelPredictFn;
  mae: number;
  confidence: ForecastConfidence;
}

function confidenceFromMae(mae: number, seriesMean: number, seriesLength: number): ForecastConfidence {
  if (seriesLength < 14) return 'low';
  if (seriesMean <= 0) return mae === 0 ? 'high' : 'low';
  const ratio = mae / seriesMean;
  if (ratio < 0.1) return 'high';
  if (ratio < 0.25) return 'medium';
  return 'low';
}

export function selectBestModel(series: number[]): ModelSelection {
  const holdout = Math.min(7, Math.floor(series.length * 0.2));
  if (series.length - holdout < 5) {
    return {
      model: 'sma',
      predict: smaForecast,
      mae: Number.POSITIVE_INFINITY,
      confidence: 'low',
    };
  }

  const train = series.slice(0, -holdout);
  const actual = series.slice(-holdout);
  const seriesMean = mean(series);

  const scored = CANDIDATES.map((fn) => {
    const predicted = fn.predict(train, holdout);
    return {
      model: fn.id,
      predict: fn.predict,
      mae: meanAbsoluteError(predicted, actual),
    };
  }).sort((a, b) => a.mae - b.mae);

  const best = scored[0];
  return {
    ...best,
    confidence: confidenceFromMae(best.mae, seriesMean, series.length),
  };
}
