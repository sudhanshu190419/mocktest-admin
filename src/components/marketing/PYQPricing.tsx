'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from './Button';
import { Card } from './Card';
import { useAuth } from '@/context/AuthContext';
import { useStudentPyqPurchases } from '@/hooks/student/useStudentPyqPurchases';
import { formatCoursePrice } from '@/services/courseCatalogService';
import { PaymentModal } from './PaymentModal';
import type { PYQPackage } from '@/types/pyqCatalog';

export function PYQPricing({ item }: { item: PYQPackage }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const { purchasedPackageIds } = useStudentPyqPurchases(profileId);
  const isPurchased = purchasedPackageIds.includes(item.packageId);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const price = item.discountedPrice;
  const formatPrice = (value: number) => formatCoursePrice(value, item.currency);
  const savings =
    item.originalPrice > price
      ? Math.round(((item.originalPrice - price) / item.originalPrice) * 100)
      : 0;

  return (
    <>
      <Card className="store-pricing">
        <div className="store-pricing-heading">
          <span className="store-eyebrow">OWN THE ARCHIVE</span>
          <span className="store-demo-tag">One-Time Payment</span>
        </div>
        <h2>
          One purchase.
          <br />
          Every past paper.
        </h2>
        <p className="store-pricing-intro">
          A single one-time price — full lifetime access to all papers in this package.
        </p>

        {isPurchased && (
          <div className="p-4 rounded-field bg-amber-50 border border-amber-200 text-amber-900 my-4">
            <span className="text-caption font-extrabold uppercase tracking-wide text-amber-800">Package Owned</span>
            <p className="text-xs font-bold text-amber-950 mt-0.5">
              You own full lifetime access to this paper package.
            </p>
          </div>
        )}

        <div className="store-price-display">
          <span className="store-small-label">{isPurchased ? 'Access Status' : 'One-time purchase'}</span>
          <div>
            {isPurchased ? (
              <strong className="text-amber-800">Active Package</strong>
            ) : (
              <>
                <strong className="tabular-nums">{formatPrice(price)}</strong>
                {savings > 0 && (
                  <del className="tabular-nums">{formatPrice(item.originalPrice)}</del>
                )}
                {savings > 0 && <em className="store-save-tag">{savings}% off</em>}
              </>
            )}
          </div>
          <p>{item.accessType} · Complete Package</p>
        </div>

        {isPurchased ? (
          <Link
            href="/student/tests"
            className="store-enroll-button inline-flex items-center justify-center text-center font-bold"
          >
            Start Practice Tests <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Button
            className="store-enroll-button"
            onClick={() => setPaymentModalOpen(true)}
          >
            Purchase Package <span aria-hidden="true">↗</span>
          </Button>
        )}

        <div className="store-included">
          <h3>Package features</h3>
          <ul>
            {item.inclusions.map((entry) => (
              <li key={entry}>
                <span aria-hidden="true">✓</span>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {isPurchased ? (
        <Link
          href="/student/tests"
          className="store-mobile-enroll"
        >
          <span>
            Status: <strong className="text-amber-800">Purchased</strong>
          </span>
          <b>Start Tests →</b>
        </Link>
      ) : (
        <a
          href="#pyq-pricing"
          className="store-mobile-enroll"
          onClick={(e) => {
            e.preventDefault();
            setPaymentModalOpen(true);
          }}
        >
          <span>
            One-time <strong className="tabular-nums">{formatPrice(price)}</strong>
          </span>
          <b>Buy Package ↑</b>
        </a>
      )}

      {/* Unified Razorpay Payment Modal */}
      <PaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        itemType="pyq"
        itemId={item.packageId}
        itemTitle={item.displayTitle}
        streamName={item.streamName}
        price={price}
        originalPrice={item.originalPrice > price ? item.originalPrice : undefined}
        currency={item.currency}
        planName="Lifetime PYQ Access"
        accessDurationLabel={`Lifetime Access · ${item.totalPapers} Official Papers`}
      />
    </>
  );
}


