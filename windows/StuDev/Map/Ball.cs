// The ball that turns the map, as on the web (src/campus/map/ball.ts): a solid sphere seen under the map's own bearing
// and pitch, its equator turning and flattening with the map and a red mark on its rim pointing north, so it reads as
// the way the campus faces and moves exactly as dragging it moves the map. Dragging it turns and tilts the map; a tap
// goes back to north seen from above, and from there back to the raised view.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;
using Windows.Foundation;
using Windows.UI;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace StuDev.Map;

public sealed partial class Ball : Grid
{
    /** The ball's radius in a box running from -22 to 22, leaving room for the turning arrows. */
    private const double Radius = 15, Box = 44, Size = 58;
    private readonly Path ring = new() { StrokeThickness = .8, Opacity = .8 };
    private readonly Path north = new();
    private readonly Path turn = new() { StrokeThickness = 1.3, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, Opacity = 0 };
    private readonly Ellipse body = new() { Width = Radius * 2, Height = Radius * 2, StrokeThickness = .6 };
    private readonly Ellipse gloss = new() { Width = 14, Height = 10 };
    /** A soft shade under the sphere, as the web's drop shadow: the ball's own shape, not its square box. */
    private readonly Ellipse shade = new() { Width = Radius * 2 + 1.5, Height = Radius * 2 + 1.5, Fill = new SolidColorBrush(Color.FromArgb(46, 0, 0, 0)) };
    private readonly Canvas canvas = new() { Width = Box, Height = Box };
    private readonly Action<double, double> steer;
    private readonly Action square;
    private readonly Action settled;
    private Point? from;
    private bool moved;
    private double bearing = -24, pitch = 52;

    public Ball(Action<double, double> steer, Action square, Action settled)
    {
        this.steer = steer; this.square = square; this.settled = settled;
        Width = 56; Height = 56; Background = Paint.Clear;
        var scale = Size / Box;
        canvas.RenderTransform = new CompositeTransform { ScaleX = scale, ScaleY = scale, TranslateX = (56 - Size) / 2, TranslateY = (56 - Size) / 2 };
        Canvas.SetLeft(body, Box / 2 - Radius); Canvas.SetTop(body, Box / 2 - Radius);
        Canvas.SetLeft(shade, Box / 2 - Radius - .75); Canvas.SetTop(shade, Box / 2 - Radius + .2);
        Canvas.SetLeft(gloss, Box / 2 - 5 - 7); Canvas.SetTop(gloss, Box / 2 - 6.5 - 5);
        gloss.RenderTransformOrigin = new Point(.5, .5); gloss.RenderTransform = new RotateTransform { Angle = -30 };
        turn.Data = Turning();
        canvas.Children.Add(turn); canvas.Children.Add(shade); canvas.Children.Add(body); canvas.Children.Add(gloss); canvas.Children.Add(ring); canvas.Children.Add(north);
        Children.Add(canvas);
        AutomationProperties.SetName(this, "拖动旋转视角，点按回正");
        ToolTipService.SetToolTip(this, "拖动小球旋转视角 · 点按回正\n也可以按住右键拖动地图");
        PointerEntered += (_, _) => turn.Opacity = 1;
        PointerExited += (_, _) => { if (from is null) turn.Opacity = 0; };
        PointerPressed += Pressed; PointerMoved += Moved; PointerReleased += Released; PointerCanceled += (_, _) => from = null;
        Paint.Turned += Colour;
        Colour();
        Draw();
    }

    /** Follows the map's camera: the equator and the north mark under its bearing and pitch. */
    public void Show(double bearing, double pitch)
    {
        if (Math.Abs(bearing - this.bearing) < .05 && Math.Abs(pitch - this.pitch) < .05) return;
        this.bearing = bearing; this.pitch = pitch;
        Draw();
    }

    private void Colour()
    {
        var paper = Paint.Of("paper", Paint.Dark); var ink = Paint.Of("ink", Paint.Dark);
        Color Mix(double keep) => Paint.Blend(paper, ink, keep);
        body.Fill = new RadialGradientBrush
        {
            Center = new Point(.35, .3), GradientOrigin = new Point(.35, .3), RadiusX = .75, RadiusY = .75,
            GradientStops = { new GradientStop { Color = paper, Offset = 0 }, new GradientStop { Color = Mix(.78), Offset = 1 } },
        };
        body.Stroke = new SolidColorBrush(Mix(.7));
        gloss.Fill = new RadialGradientBrush
        {
            GradientStops = { new GradientStop { Color = Color.FromArgb(217, 255, 255, 255), Offset = 0 }, new GradientStop { Color = Color.FromArgb(0, 255, 255, 255), Offset = 1 } },
        };
        ring.Stroke = Paint.Brush("faint"); north.Fill = Paint.Brush("danger"); turn.Stroke = Paint.Brush("muted");
    }

    private static Point At(double x, double y) => new(Box / 2 + x * Radius, Box / 2 - y * Radius);

    /** The near half of the equator and the north mark, as orientationBall draws them. */
    private void Draw()
    {
        const double rad = Math.PI / 180;
        double sb = Math.Sin(bearing * rad), cb = Math.Cos(bearing * rad), sp = Math.Sin(pitch * rad), cp = Math.Cos(pitch * rad);
        var figures = new PathFigureCollection();
        PathFigure? figure = null;
        for (var lon = 0; lon <= 360; lon += 4)
        {
            double x = Math.Sin(lon * rad), y = Math.Cos(lon * rad);
            double rx = x * cb - y * sb, ry = x * sb + y * cb;
            double vy = ry * cp, vz = -ry * sp;
            if (vz < 0) { figure = null; continue; }
            var point = At(rx, vy);
            if (figure is null) { figure = new PathFigure { StartPoint = point, IsClosed = false }; figures.Add(figure); }
            else figure.Segments.Add(new LineSegment { Point = point });
        }
        ring.Data = new PathGeometry { Figures = figures };
        // North on the screen, at the rim, so no tilt ever hides it behind the ball.
        double dx = -Math.Sin(bearing * rad), dy = Math.Cos(bearing * rad);
        Point Tip(double r, double side) => At((dx * r - dy * side) / Radius, (dy * r + dx * side) / Radius);
        var tip = new PathFigure { StartPoint = Tip(Radius + 5, 0), IsClosed = true };
        tip.Segments.Add(new LineSegment { Point = Tip(Radius - 1.5, 3.4) });
        tip.Segments.Add(new LineSegment { Point = Tip(Radius - 1.5, -3.4) });
        north.Data = new PathGeometry { Figures = { tip } };
    }

    /** The two curved arrows either side, shown while the pointer is over the ball. */
    private static PathGeometry Turning()
    {
        static Point P(double x, double y) => new(Box / 2 + x, Box / 2 + y);
        var geometry = new PathGeometry();
        void Arc(double sx, double sy, double ex, double ey, SweepDirection sweep)
        {
            var figure = new PathFigure { StartPoint = P(sx, sy) };
            figure.Segments.Add(new ArcSegment { Point = P(ex, ey), Size = new Size(20, 20), SweepDirection = sweep });
            geometry.Figures.Add(figure);
        }
        void Line(params (double X, double Y)[] points)
        {
            var figure = new PathFigure { StartPoint = P(points[0].X, points[0].Y) };
            foreach (var (x, y) in points.Skip(1)) figure.Segments.Add(new LineSegment { Point = P(x, y) });
            geometry.Figures.Add(figure);
        }
        Arc(-19.5, -6, -19.5, 6, SweepDirection.Counterclockwise); Line((-21.6, 3.4), (-19.5, 6), (-17, 4.2));
        Arc(19.5, 6, 19.5, -6, SweepDirection.Counterclockwise); Line((21.6, -3.4), (19.5, -6), (17, -4.2));
        return geometry;
    }

    private void Pressed(object sender, PointerRoutedEventArgs e)
    {
        from = e.GetCurrentPoint(this).Position; moved = false;
        CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void Moved(object sender, PointerRoutedEventArgs e)
    {
        if (from is not { } start) return;
        var at = e.GetCurrentPoint(this).Position;
        double dx = at.X - start.X, dy = at.Y - start.Y;
        if (!moved && Math.Sqrt(dx * dx + dy * dy) < 4) return;
        moved = true;
        steer(dx * .9, -dy * .5);
        from = at;
        e.Handled = true;
    }

    private void Released(object sender, PointerRoutedEventArgs e)
    {
        if (from is null) return;
        from = null;
        ReleasePointerCapture(e.Pointer);
        if (!moved) square(); else settled();
        turn.Opacity = 0;
        e.Handled = true;
    }
}
