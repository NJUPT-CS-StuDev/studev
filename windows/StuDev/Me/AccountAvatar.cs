using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;

namespace StuDev.Me;

/** The public QQ face shared by the account and the window, with a letter only when no picture is available. */
public sealed partial class AccountAvatar : Grid
{
    private readonly ContentControl fallback = new() { HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly Ellipse picture = new() { Opacity = 0 };
    private BitmapImage? image;
    private string? identity;
    public string Status { get; private set; } = "未登录";
    public event Action? Changed;

    public AccountAvatar(double diameter = 32)
    {
        Width = Height = diameter;
        Children.Add(new Ellipse { Fill = Paint.Brush("surfaceSunken") });
        Children.Add(fallback);
        Children.Add(picture);
        AutomationProperties.SetName(this, "头像");
    }

    public void Show(AccountUser? user)
    {
        var qq = user?.Qq.Trim() ?? "";
        var valid = qq.Length is >= 5 and <= 12 && qq[0] is >= '1' and <= '9' && qq.All(c => c is >= '0' and <= '9');
        ShowImage(valid ? $"https://q1.qlogo.cn/g?b=qq&nk={qq}&s=100" : null, user?.Letter);
    }

    public void ShowImage(string? url, string? letter)
    {
        fallback.Content = letter is null ? Kit.Icon(Icons.Person, Width * 18 / 32, "muted", 24, 1.8) : new TextBlock
        {
            Text = letter, FontSize = Width * 12.5 / 32, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = Paint.Brush("muted"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
        };
        var next = letter is null ? null : url ?? "";
        if (identity == next) return;
        identity = next;
        image = null;
        picture.Fill = null;
        picture.Opacity = 0;
        fallback.Visibility = Visibility.Visible;
        State(letter is null ? "未登录" : url is not null ? "正在加载头像" : "未设置头像");
        if (url is null) return;

        var bitmap = new BitmapImage { DecodePixelWidth = 100 };
        image = bitmap;
        picture.Fill = new ImageBrush { ImageSource = bitmap, Stretch = Stretch.UniformToFill };
        bitmap.ImageOpened += (_, _) =>
        {
            if (!ReferenceEquals(image, bitmap)) return;
            picture.Opacity = 1;
            fallback.Visibility = Visibility.Collapsed;
            State("头像已加载");
        };
        bitmap.ImageFailed += (_, _) =>
        {
            if (!ReferenceEquals(image, bitmap)) return;
            picture.Opacity = 0;
            fallback.Visibility = Visibility.Visible;
            State("头像暂未加载");
        };
        bitmap.UriSource = new Uri(url);
    }

    private void State(string status)
    {
        Status = status;
        AutomationProperties.SetHelpText(this, status);
        Changed?.Invoke();
    }
}
