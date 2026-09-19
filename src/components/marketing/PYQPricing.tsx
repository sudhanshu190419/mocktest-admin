'use client';

import { useState } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { formatCoursePrice } from '@/services/courseCatalogService';
import { PaymentModal } from './PaymentModal';
import type { PYQPackage } from '@/types/pyqCatalog';

export function PYQPricing({ item }: { item: PYQPackage }) {
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
        <div className="store-price-display">
          <span className="store-small-label">One-time purchase</span>
          <div>
            <strong className="tabular-nums">{formatPrice(price)}</strong>
            {savings > 0 && (
              <del className="tabular-nums">{formatPrice(item.originalPrice)}</del>
            )}
            {savings > 0 && <em className="store-save-tag">{savings}% off</em>}
          </div>
          <p>{item.accessType} · Complete Package</p>
        </div>
        <Button
          className="store-enroll-button"
          onClick={() => setPaymentModalOpen(true)}
        >
          Enroll in package <span aria-hidden="true">↗</span>
        </Button>
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
        <b>Enroll now ↑</b>
      </a>

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

