# Theme System

This theme system provides consistent styling across all Green Bunch projects. It's designed to work with Tailwind CSS and provides RTL/LTR support integrated with the i18n system.

## Features

- **Consistent Colors**: Matches the admin project's color scheme
- **RTL/LTR Support**: Automatically detects and applies proper direction based on language
- **Font Management**: Applies appropriate fonts for Persian (RTL) and English (LTR)
- **Tailwind Integration**: Works seamlessly with existing Tailwind CSS classes
- **i18n Integration**: Syncs with the existing i18n system for language detection

## Usage

### Basic Setup

The ThemeProvider is already integrated in `main.tsx`. It wraps the entire application:

```tsx
import { ThemeProvider } from './theme';

// Already set up in main.tsx
<ThemeProvider>
  <AuthProvider>
    <App />
  </AuthProvider>
</ThemeProvider>
```

### Using the Theme Hook

```tsx
import { useTheme } from '../theme';

const MyComponent = () => {
  const { isRtl, currentLang, theme } = useTheme();

  return (
    <div 
      className={`p-4 ${isRtl ? 'text-right' : 'text-left'}`}
      style={{ backgroundColor: theme.colors.primary.main }}
    >
      <h1>{isRtl ? 'سلام' : 'Hello'}</h1>
    </div>
  );
};
```

### Available Theme Colors

```tsx
// Primary colors
theme.colors.primary.main     // #4CAF50
theme.colors.primary.dark     // #388E3C
theme.colors.primary.light    // #81C784

// Secondary colors
theme.colors.secondary.main   // #FF5722
theme.colors.secondary.dark   // #D84315
theme.colors.secondary.light  // #FF8A65

// Brand colors
theme.colors['gb-green']      // #4CAF50
theme.colors['gb-green-dark'] // #388E3C
theme.colors['gb-orange']     // #FF5722
theme.colors['gb-pink']       // rgb(236, 72, 153)
```

### Tailwind CSS Classes

You can also use the predefined Tailwind classes:

```tsx
<div className="bg-primary text-white">Primary background</div>
<div className="bg-secondary text-white">Secondary background</div>
<div className="bg-gb-green text-white">Green Bunch green</div>
<div className="bg-gb-orange text-white">Green Bunch orange</div>
```

### RTL/LTR Handling

```tsx
const { isRtl } = useTheme();

// Conditional classes
<div className={`flex ${isRtl ? 'flex-row-reverse' : 'flex-row'}`}>
  <div>First item</div>
  <div>Second item</div>
</div>

// Conditional text alignment
<p className={isRtl ? 'text-right' : 'text-left'}>
  Text content
</p>
```

### Border Radius

```tsx
// Using theme values
<div style={{ borderRadius: theme.borderRadius.small }}>8px radius</div>
<div style={{ borderRadius: theme.borderRadius.medium }}>12px radius</div>
<div style={{ borderRadius: theme.borderRadius.large }}>16px radius</div>
```

## Integration with Admin Project

This theme system is designed to match the admin project's theming:

- **Same color palette**: Ensures visual consistency across projects
- **Same font choices**: Persian fonts for RTL, standard fonts for LTR
- **Same border radius values**: Consistent component styling
- **Compatible structure**: Easy to port components between projects

## Language Detection

The theme automatically detects the current language through:

1. Document `lang` attribute
2. Document `dir` attribute  
3. localStorage `lang` value
4. Defaults to Persian (`fa`)

Language changes are automatically detected and applied through:
- Storage events (when localStorage changes)
- DOM mutation observer (when document attributes change)

## Example Component

See `components/ThemeExample.tsx` for a complete example of how to use all theme features.