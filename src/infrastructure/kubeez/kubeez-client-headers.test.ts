import { describe, it, expect } from 'vitest';
import { buildKubeezApiHeaders, CLIENT_TRACE_HEADER_VALUE } from './kubeez-client-headers';

describe('buildKubeezApiHeaders', () => {
  it('attaches a stable trace token', () => {
    const h = buildKubeezApiHeaders({ apiKey: 'sk_test_abc' });
    expect(h['X-Client-Trace']).toBe(CLIENT_TRACE_HEADER_VALUE);
    expect(CLIENT_TRACE_HEADER_VALUE.length).toBeGreaterThan(0);
  });

  it('always sends a non-empty build identifier', () => {
    const h = buildKubeezApiHeaders({ apiKey: 'sk_test_abc' });
    expect(h['X-Client-Build']).toBeTruthy();
    expect(h['X-Client-Build']!.length).toBeGreaterThan(0);
    expect(h['X-Client-Build']!.length).toBeLessThanOrEqual(32);
  });

  it('sets a Bearer Authorization with the supplied apiKey verbatim', () => {
    const h = buildKubeezApiHeaders({ apiKey: 'eyJhlonglongjwt' });
    expect(h.Authorization).toBe('Bearer eyJhlonglongjwt');
  });

  it('merges in extra headers without dropping the trace + build pair', () => {
    const h = buildKubeezApiHeaders({
      apiKey: 'sk_test_abc',
      extra: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    });
    expect(h['Content-Type']).toBe('application/json');
    expect(h.Accept).toBe('text/event-stream');
    expect(h['X-Client-Trace']).toBe(CLIENT_TRACE_HEADER_VALUE);
    expect(h.Authorization).toBe('Bearer sk_test_abc');
  });

  it('lets `extra` override Authorization if a caller really wants to (last-write-wins)', () => {
    const h = buildKubeezApiHeaders({
      apiKey: 'sk_test_abc',
      extra: { Authorization: 'Bearer override' },
    });
    expect(h.Authorization).toBe('Bearer override');
  });
});
