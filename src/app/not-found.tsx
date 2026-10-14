import Link from "next/link";
export default function NotFound() {
  return (
    <div className="panel empty-state">
      <h1>This page is out of tune.</h1>
      <p>Let’s get you back to your practice space.</p>
      <Link href="/" className="button primary">
        Back to dashboard
      </Link>
    </div>
  );
}
