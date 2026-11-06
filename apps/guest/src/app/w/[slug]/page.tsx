import { Providers } from '../../providers';
import { JoinQueue } from '@/components/queue/join-queue';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Providers>
      <JoinQueue slug={slug} />
    </Providers>
  );
}
