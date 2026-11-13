// The few stock WinUI controls kept (text boxes, toggles, pickers, scroll bars) wear StuDev's tokens: the platform's
// own resource keys are redefined, light and dark, from design/tokens.json, so the accent is the brand, the words are
// ink, the hairlines are the line, and corners are the tokens' radii.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace StuDev.Ui;

public static class Theme
{
    public static ResourceDictionary Build()
    {
        var all = new ResourceDictionary();
        all.ThemeDictionaries["Light"] = For(false);
        all.ThemeDictionaries["Dark"] = For(true);
        all["ControlCornerRadius"] = new CornerRadius(Paint.Number("radius", "control"));
        all["OverlayCornerRadius"] = new CornerRadius(Paint.Number("radius", "sheet"));
        all["TextControlBorderThemeThickness"] = new Thickness(1);
        all["TextControlBorderThemeThicknessFocused"] = new Thickness(1);
        all["TextControlThemePadding"] = new Thickness(12, 7, 8, 7);
        all["ContentControlFontSize"] = Paint.Number("type", "body", "size");
        all["ControlContentThemeFontSize"] = Paint.Number("type", "body", "size");
        all["ScrollBarSize"] = 12.0;
        return all;
    }

    private static ResourceDictionary For(bool dark)
    {
        Color c(string name) => Paint.Of(name, dark);
        var brand = c("brand"); var paper = c("paper"); var ink = c("ink");
        var d = new ResourceDictionary();
        void color(string key, Color value) => d[key] = value;
        void brush(Color value, params string[] keys) { foreach (var key in keys) d[key] = new SolidColorBrush(value); }

        color("SystemAccentColor", brand);
        foreach (var (key, keep) in new[] { ("Light1", .82), ("Light2", .64), ("Light3", .46) }) color("SystemAccentColor" + key, Paint.Blend(brand, Colors.White, keep));
        foreach (var (key, keep) in new[] { ("Dark1", .86), ("Dark2", .72), ("Dark3", .58) }) color("SystemAccentColor" + key, Paint.Blend(brand, Colors.Black, keep));
        var hover = Paint.Blend(brand, dark ? Colors.White : Colors.Black, .9);
        brush(brand, "AccentFillColorDefaultBrush", "AccentTextFillColorPrimaryBrush", "AccentTextFillColorSecondaryBrush", "AccentTextFillColorTertiaryBrush", "SystemControlHighlightAccentBrush",
            "TextControlBorderBrushFocused", "TextControlSelectionHighlightColor", "ToggleSwitchFillOn", "ToggleSwitchStrokeOn", "CheckBoxCheckBackgroundFillChecked", "CheckBoxCheckBackgroundStrokeChecked",
            "RadioButtonOuterEllipseCheckedFill", "RadioButtonOuterEllipseCheckedStroke", "ProgressRingForegroundThemeBrush", "ProgressBarForeground", "SliderTrackValueFill", "SliderThumbBackground",
            "FocusStrokeColorOuterBrush", "CalendarViewSelectedBorderBrush", "CalendarViewTodayBackground");
        brush(hover, "AccentFillColorSecondaryBrush", "ToggleSwitchFillOnPointerOver", "ToggleSwitchStrokeOnPointerOver", "CheckBoxCheckBackgroundFillCheckedPointerOver", "SliderTrackValueFillPointerOver", "SliderThumbBackgroundPointerOver");
        brush(Paint.Blend(brand, paper, .8), "AccentFillColorTertiaryBrush", "ToggleSwitchFillOnPressed", "CheckBoxCheckBackgroundFillCheckedPressed", "SliderThumbBackgroundPressed");
        brush(c("onBrand"), "TextOnAccentFillColorPrimaryBrush", "TextOnAccentFillColorSecondaryBrush", "ToggleSwitchKnobFillOn", "ToggleSwitchKnobFillOnPointerOver", "ToggleSwitchKnobFillOnPressed", "CheckBoxCheckGlyphForegroundChecked");

        brush(ink, "TextFillColorPrimaryBrush", "TextControlForeground", "TextControlForegroundPointerOver", "TextControlForegroundFocused", "SystemControlForegroundBaseHighBrush", "ApplicationForegroundThemeBrush", "ToggleSwitchContentForeground", "ComboBoxForeground");
        brush(c("muted"), "TextFillColorSecondaryBrush", "TextControlHeaderForeground", "SystemControlForegroundBaseMediumBrush", "ToggleSwitchStrokeOff", "ToggleSwitchKnobFillOff", "ComboBoxDropDownGlyphForeground");
        brush(c("faint"), "TextFillColorTertiaryBrush", "TextFillColorDisabledBrush", "TextControlPlaceholderForeground", "TextControlPlaceholderForegroundPointerOver", "TextControlPlaceholderForegroundFocused", "ToggleSwitchStrokeOffPointerOver", "ToggleSwitchKnobFillOffPointerOver");

        brush(paper, "SolidBackgroundFillColorBaseBrush", "ApplicationPageBackgroundThemeBrush", "TextControlBackground", "TextControlBackgroundFocused", "ComboBoxBackground", "ComboBoxBackgroundFocused",
            "ControlFillColorInputActiveBrush", "CardBackgroundFillColorDefaultBrush", "ToggleSwitchFillOff", "CalendarDatePickerBackground", "TimePickerButtonBackground", "DatePickerButtonBackground");
        brush(c("surface"), "SolidBackgroundFillColorSecondaryBrush", "TextControlBackgroundPointerOver", "ComboBoxBackgroundPointerOver", "ControlFillColorDefaultBrush", "ControlFillColorSecondaryBrush",
            "SubtleFillColorSecondaryBrush", "ToggleSwitchFillOffPointerOver", "CalendarDatePickerBackgroundPointerOver", "TimePickerButtonBackgroundPointerOver", "DatePickerButtonBackgroundPointerOver", "ListViewItemBackgroundPointerOver");
        brush(c("surfaceRaised"), "AcrylicInAppFillColorDefaultBrush", "FlyoutPresenterBackground", "MenuFlyoutPresenterBackground", "ComboBoxDropDownBackground", "SolidBackgroundFillColorTertiaryBrush", "LayerFillColorDefaultBrush");
        brush(c("line"), "ControlStrokeColorDefaultBrush", "ControlStrokeColorSecondaryBrush", "CardStrokeColorDefaultBrush", "DividerStrokeColorDefaultBrush", "SurfaceStrokeColorFlyoutBrush",
            "TextControlBorderBrush", "ComboBoxBorderBrush", "FlyoutBorderThemeBrush", "MenuFlyoutPresenterBorderBrush", "ComboBoxDropDownBorderBrush", "CalendarDatePickerBorderBrush", "TimePickerButtonBorderBrush", "DatePickerButtonBorderBrush");
        brush(Paint.Blend(c("line"), ink, .8), "TextControlBorderBrushPointerOver", "ComboBoxBorderBrushPointerOver", "CalendarDatePickerBorderBrushPointerOver", "TimePickerButtonBorderBrushPointerOver");
        brush(Paint.Alpha(brand, dark ? .32 : .2), "ListViewItemBackgroundSelected", "ComboBoxItemBackgroundSelected");
        brush(ink, "FocusStrokeColorOuterBrush");
        brush(paper, "FocusStrokeColorInnerBrush");
        brush(Colors.Transparent, "TextControlButtonBackground", "ButtonBorderBrush");
        return d;
    }

    private static class Colors
    {
        public static readonly Color White = Color.FromArgb(255, 255, 255, 255);
        public static readonly Color Black = Color.FromArgb(255, 0, 0, 0);
        public static readonly Color Transparent = Color.FromArgb(0, 0, 0, 0);
    }
}
