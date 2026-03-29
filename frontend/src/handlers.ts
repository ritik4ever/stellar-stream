import { http, HttpResponse } from 'msw';

export const handlers = [
  // Mocking GET streams based on your README's API schema
  http.get('/api/streams', () => {
    return HttpResponse.json({
      data: [
        { id: '1', sender: 'G_SENDER1', recipient: 'G_RECIPIENT1', totalAmount: 100, durationSeconds: 3600, status: 'active', progress: { vested: 50, remaining: 50 } }
      ],
      total: 1,
      page: 1,
      limit: 20
    });
  }),
  http.post('/api/streams', () => {
    return HttpResponse.json({ data: { id: '2', success: true } }, { status: 201 });
  }),
  http.get('/api/streams/:id', ({ params }) => {
    const { id } = params;
    if (id === 'missing') {
      return HttpResponse.json({ error: 'Stream not found' }, { status: 404 });
    }
    return HttpResponse.json({
      data: {
        id,
        sender: 'GSENDER123',
        recipient: 'GRECIPIENT456',
        assetCode: 'USDC',
        totalAmount: 1000,
        durationSeconds: 86400,
        startAt: 1700000000,
        createdAt: 1699990000,
        progress: {
          status: 'active',
          ratePerSecond: 0.01157,
          elapsedSeconds: 43200,
          vestedAmount: 500,
          remainingAmount: 500,
          percentComplete: 50,
        },
      },
    });
  }),
  http.get('/api/streams/:id/history', ({ params }) => {
    const { id } = params;
    if (id === 'missing') {
      return HttpResponse.json({ data: [] });
    }
    return HttpResponse.json({
      data: [
        {
          id: 1,
          streamId: id,
          eventType: 'created',
          timestamp: 1699990000,
          actor: 'GSENDER123',
        },
        {
          id: 2,
          streamId: id,
          eventType: 'claimed',
          timestamp: 1700010000,
          actor: 'GRECIPIENT456',
          amount: 100,
        },
      ],
    });
  }),
];