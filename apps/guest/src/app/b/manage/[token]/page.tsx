import { Providers } from '../../../providers';
import { ManageBooking } from '@/components/booking/manage-booking';

export const metadata = { robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Providers>
      <ManageBooking token={token} />
    </Providers>
  );
}
