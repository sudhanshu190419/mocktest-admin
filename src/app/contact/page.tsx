import type { Metadata } from 'next';
import { ContactUsView } from '@/components/marketing/ContactUsView';

export const metadata: Metadata = {
  title: 'Contact Us — Make Me Topper',
  description:
    'Get in touch with the Make Me Topper support and admissions team. Reach out via phone, WhatsApp, email, or send us a message for course, mock test, and doubt assistance.',
};

export default function ContactPage() {
  return <ContactUsView />;
}
