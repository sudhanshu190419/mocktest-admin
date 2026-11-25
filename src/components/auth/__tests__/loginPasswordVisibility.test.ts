import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 1 Login Password Visibility & Accessibility Contract', () => {
  const authShellPath = path.resolve(__dirname, '../AuthPreviewShell.tsx');
  const authShellSource = fs.readFileSync(authShellPath, 'utf8');

  const authCssPath = path.resolve(__dirname, '../auth-preview.css');
  const authCssSource = fs.readFileSync(authCssPath, 'utf8');

  it('imports Eye and EyeSlash from @phosphor-icons/react', () => {
    expect(authShellSource).toMatch(/import\s+\{[^}]*Eye[^}]*EyeSlash[^}]*\}\s+from\s+['"]@phosphor-icons\/react['"]/);
  });

  it('declares PasswordField with show/hide state initialized to hidden (false)', () => {
    // Verifies state declaration
    expect(authShellSource).toContain('const [showPassword, setShowPassword] = useState(false);');

    // Verifies input type conditionally reflects showPassword
    expect(authShellSource).toContain('type={showPassword ? \'text\' : \'password\'}');

    // Verifies toggle button semantics and accessibility
    expect(authShellSource).toContain('type="button"');
    expect(authShellSource).toContain('aria-label={showPassword ? \'Hide password\' : \'Show password\'}');
    expect(authShellSource).toContain('tabIndex={0}');

    // Verifies Phosphor icons toggle between Eye and EyeSlash
    expect(authShellSource).toContain('{showPassword ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}');
  });

  it('declares ConfirmPasswordField for password recovery with show/hide functionality', () => {
    expect(authShellSource).toContain('const [showConfirm, setShowConfirm] = useState(false);');
    expect(authShellSource).toContain('type={showConfirm ? \'text\' : \'password\'}');
    expect(authShellSource).toContain('aria-label={showConfirm ? \'Hide password\' : \'Show password\'}');
    expect(authShellSource).toContain('tabIndex={0}');
    expect(authShellSource).toContain('{showConfirm ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}');
  });

  it('verifies login form binds PasswordField without mutating submit handlers or values', () => {
    expect(authShellSource).toContain('<PasswordField value={password} onChange={setPassword} current={!signup} />');
  });

  it('ensures auth-preview.css styles the password container, right-padding, and absolute toggle button', () => {
    // Container
    expect(authCssSource).toContain('.auth-password-input {');
    expect(authCssSource).toContain('position: relative;');
    expect(authCssSource).toContain('display: flex;');

    // Input right-padding to accommodate toggle icon without text overlap
    expect(authCssSource).toMatch(/\.auth-password-input input\s*\{[^}]*padding:\s*12px 44px 12px 12px/);

    // Toggle button position & accessibility
    expect(authCssSource).toContain('.auth-password-toggle {');
    expect(authCssSource).toMatch(/\.auth-password-toggle\s*\{[^}]*position:\s*absolute/);
    expect(authCssSource).toMatch(/\.auth-password-toggle\s*\{[^}]*right:\s*12px/);
    expect(authCssSource).toMatch(/\.auth-password-toggle\s*\{[^}]*top:\s*50%/);
    expect(authCssSource).toMatch(/\.auth-password-toggle\s*\{[^}]*transform:\s*translateY\(-50%\)/);
    expect(authCssSource).toContain('.auth-password-toggle:focus-visible');

    // Exclusion rule prevents parent .auth-field span styling from interfering
    expect(authCssSource).toContain(':not(.auth-password-input)');
  });

  it('preserves existing authentication logic, handlers, and validation', () => {
    // Verifies signIn handler remains intact
    expect(authShellSource).toContain('await signIn(fullPhone, password, captchaToken || undefined);');

    // Verifies signUp handler remains intact
    expect(authShellSource).toContain('await signUp({');
    expect(authShellSource).toContain('name: name.trim(),');
    expect(authShellSource).toContain('phone: fullPhone,');
    expect(authShellSource).toContain('password,');

    // Verifies password update handler remains intact
    expect(authShellSource).toContain('await updatePassword(password);');

    // Verifies minLength and maxLength validation constraints on password fields
    expect(authShellSource).toContain('minLength={6}');
    expect(authShellSource).toContain('maxLength={128}');
  });
});
