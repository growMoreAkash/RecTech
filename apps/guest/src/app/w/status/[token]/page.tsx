import { Providers } from '../../../providers';
import { QueueStatus } from '@/components/queue/queue-status';

export const metadata = { robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Providers>
      <QueueStatus token={token} />
    </Providers>
  );
}
