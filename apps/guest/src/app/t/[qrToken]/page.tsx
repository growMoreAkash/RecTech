import { Providers } from '../../providers';
import { TablePage } from '@/components/table-page';

export default async function Page({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  return (
    <Providers>
      <TablePage qr={qrToken} />
    </Providers>
  );
}
