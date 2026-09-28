import { afterEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

describe('sendEmail (Resend)', () => {
  afterEach(() => { vi.resetModules(); send.mockReset(); });

  it('sends through Resend with a branded From on the verified sending domain', async () => {
    process.env.RESEND_API_KEY = 're_x'; process.env.EMAIL_FROM = 'Preciops <notifications@mail.preciopsatms.com>';
    send.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendEmail } = await import('@/lib/email');
    expect(await sendEmail({ to: 'a@x.test', subject: 'S', text: 'T', fromName: 'Demo Staffing', replyTo: 'r@x.test', attachments: [{ filename: 'a.pdf', content: Buffer.from('%PDF') }] })).toEqual({ id: 'em_1' });
    expect(send.mock.calls[0][0]).toMatchObject({ from: 'Demo Staffing <notifications@mail.preciopsatms.com>', to: 'a@x.test', replyTo: 'r@x.test', subject: 'S', text: 'T', attachments: [{ filename: 'a.pdf' }] });
  });

  it('uses EMAIL_FROM as-is without a name, and surfaces provider errors', async () => {
    process.env.RESEND_API_KEY = 're_x';
    send.mockResolvedValue({ data: null, error: { message: 'Domain not verified' } });
    const { sendEmail } = await import('@/lib/email');
    await expect(sendEmail({ to: 'a@x.test', subject: 'S', text: 'T' })).rejects.toThrow('Domain not verified');
    expect(send.mock.calls[0][0].from).toBe('Preciops <notifications@mail.preciopsatms.com>');
  });

  it('is a logged no-op without an API key', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail } = await import('@/lib/email');
    expect(await sendEmail({ to: 'a@x.test', subject: 'S', text: 'T' })).toEqual({ id: 'dev-noop' });
    expect(send).not.toHaveBeenCalled();
  });
});
