import { requirePageContext } from '@/lib/tenant';
import { status } from '@/lib/two-step';
import TwoStep from '@/components/TwoStep';

export default async function Account() {
  const { user, org } = await requirePageContext();
  return (
    <>
      <h1>My sign-in</h1>
      <p className="lede">Signed in as <b>{user.email}</b>. These settings are yours, not your company’s: they apply wherever you sign in with this email.</p>
      <TwoStep email={user.email} initial={await status(user.id)} required={org.requireTwoStep} />
      <p className="muted">Forgot your password? Sign out and use “Forgot password?” on the sign-in page.</p>
    </>
  );
}
