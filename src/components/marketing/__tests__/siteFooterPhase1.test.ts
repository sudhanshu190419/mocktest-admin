import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 1 SiteFooter Architecture and Content Contracts', () => {
  const footerFilePath = path.resolve(__dirname, '../SiteFooter.tsx');
  const footerSource = fs.readFileSync(footerFilePath, 'utf8');

  it('verifies Column 3 heading is renamed to "Courses" from "Popular Exams"', () => {
    expect(footerSource).not.toContain('Popular Exams');
    expect(footerSource).toContain('<h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-2 sm:mb-3.5">Courses</h4>');
  });

  it('verifies the 6 courses are present in the exact specified order with valid routes', () => {
    const expectedCourses = [
      { label: '8–10th Grade', href: '/courses?stream=Foundation' },
      { label: '11–12th Grade', href: '/courses' },
      { label: 'JEE', href: '/courses?stream=JEE' },
      { label: 'NEET', href: '/courses?stream=NEET' },
      { label: 'UPSC', href: '/courses?stream=UPSC' },
      { label: 'CUET', href: '/courses?stream=CUET' },
    ];

    // Find the Courses column block
    const coursesBlockMatch = footerSource.match(/\{\/\* Column 3: Courses [\s\S]*?<\/ul>/);
    expect(coursesBlockMatch).not.toBeNull();
    const coursesBlock = coursesBlockMatch![0];

    // Extract all links within the Courses column
    const linkMatches = [...coursesBlock.matchAll(/<Link\s+href="([^"]+)"[^>]*>([^<]+)<\/Link>/g)];
    expect(linkMatches.length).toBe(6);

    expectedCourses.forEach((expected, index) => {
      const match = linkMatches[index];
      expect(match[1]).toBe(expected.href);
      expect(match[2].trim()).toBe(expected.label);
    });
  });

  it('verifies the tagline is updated to "Learn, Aspire, Achieve"', () => {
    expect(footerSource).toContain('<span>Learn, Aspire, Achieve</span>');
    expect(footerSource).not.toContain('<span>Dream</span>');
    expect(footerSource).not.toContain('<span>Practice</span>');
  });

  it('verifies the Delete Account link is removed from footer Support column', () => {
    const supportBlockMatch = footerSource.match(/\{\/\* Column 4: Support [\s\S]*?<\/ul>/);
    expect(supportBlockMatch).not.toBeNull();
    const supportBlock = supportBlockMatch![0];

    expect(supportBlock).not.toContain('Delete Account');
    expect(supportBlock).not.toContain('/delete-account');
  });

  it('verifies that the backend /delete-account route still exists intact', () => {
    const deleteAccountRoutePath = path.resolve(__dirname, '../../../app/delete-account/page.tsx');
    expect(fs.existsSync(deleteAccountRoutePath)).toBe(true);
    const deleteAccountSource = fs.readFileSync(deleteAccountRoutePath, 'utf8');
    expect(deleteAccountSource.length).toBeGreaterThan(0);
  });

  it('verifies Quick Links contains About Us alongside the standard navigation links', () => {
    const quickLinksBlockMatch = footerSource.match(/\{\/\* Column 2: Quick Links [\s\S]*?<\/ul>/);
    expect(quickLinksBlockMatch).not.toBeNull();
    const quickLinksBlock = quickLinksBlockMatch![0];

    expect(quickLinksBlock).toContain('Home');
    expect(quickLinksBlock).toContain('About Us');
    expect(quickLinksBlock).toContain('href="/about"');
    expect(quickLinksBlock).toContain('Courses');
    expect(quickLinksBlock).toContain('Mock Tests');
    expect(quickLinksBlock).toContain('PYQ Packages');
    expect(quickLinksBlock).toContain('Live Classes');
    expect(quickLinksBlock).toContain('Blog');
    expect(quickLinksBlock).toContain('My Learning');
  });

  it('verifies brand logo and styling classes are strictly preserved', () => {
    expect(footerSource).toContain('src="/brand/logo-primary-horizontal.svg"');
    expect(footerSource).toContain('width={210}');
    expect(footerSource).toContain('height={50}');
    expect(footerSource).toContain('bg-[#def0fe]');
    expect(footerSource).toContain('border-sky-200/60');
  });
});
