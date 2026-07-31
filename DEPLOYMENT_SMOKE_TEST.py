"""Run from the repository root before or after changing deployment files."""
from fastapi.testclient import TestClient
from backend.main import app


def main() -> None:
    with TestClient(app) as client:
        health = client.get('/api/health')
        health.raise_for_status()
        assert health.json().get('status') == 'ok'
        assert health.json().get('model_loaded') is True

        regions = client.get('/api/regions')
        regions.raise_for_status()
        assert len(regions.json()) == 16

        forecast = client.get('/api/forecast/13')
        forecast.raise_for_status()
        payload = forecast.json()
        assert len(payload.get('annual', [])) == 75
        assert len(payload.get('quarterly', [])) == 300

        prediction = client.post('/api/predict', json={
            'region_id': 13,
            'quarter': 1,
            'temperature': 27.5,
            'dew_point': 22.0,
            'precipitation': 100.0,
            'wind_speed': 5.0,
            'humidity': 80.0,
        })
        prediction.raise_for_status()
        assert prediction.json().get('predicted_yield_t_ha') is not None

        preload_status = client.get('/api/elevation-preload/region12/status')
        preload_status.raise_for_status()
        assert preload_status.json().get('status') in {'idle', 'starting', 'running', 'stopping', 'completed', 'cancelled', 'failed'}

        index = client.get('/')
        index.raise_for_status()
        assert 'PAL-AI' in index.text

    print('PAL-AI deployment smoke test passed.')


if __name__ == '__main__':
    main()
