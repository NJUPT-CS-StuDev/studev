// The baked campus buildings, drawn as the website's model layer draws them (src/campus/map/models.ts): a soft sky
// and one low sun from the south-east, so faces read apart without any texture; darker by night; faded towards the
// campus when a building is open. Each vertex is 12 bytes: position int16 ×3, normal snorm8 ×3, colour unorm8 ×3,
// read as three aligned 32-bit words and unpacked here, since Direct3D reads no attribute at an odd offset.
cbuffer Look : register(b0)
{
    row_major float4x4 Matrix;
    float Flatten;
    float Night;
    float Faded;
    float Unused;
    float3 FadeTo;
    float Unused2;
};

struct Vertex { uint3 Words : WORDS; };
struct Pixel { float4 Position : SV_Position; float3 Normal : NORMAL; float3 Colour : COLOR; };

Pixel Vertices(Vertex input)
{
    uint a = input.Words.x, b = input.Words.y, c = input.Words.z;
    // Sign-extends the low 16 or 8 bits of a word shifted into the top.
    float x = (float)((int)(a << 16) >> 16), y = (float)((int)a >> 16), z = (float)((int)(b << 16) >> 16);
    float3 normal = float3((int)(b << 8) >> 24, (int)b >> 24, (int)(c << 24) >> 24) / 127.0;
    float3 colour = float3((c >> 8) & 0xFF, (c >> 16) & 0xFF, c >> 24) / 255.0;
    Pixel output;
    output.Position = mul(Matrix, float4(x, y, z * Flatten, 1.0));
    output.Normal = normal;
    output.Colour = colour;
    return output;
}

float4 Pixels(Pixel input) : SV_Target
{
    float3 n = normalize(input.Normal);
    float sky = 0.62 + 0.38 * max(n.z, 0.0);
    float sun = max(dot(n, normalize(float3(0.45, -0.6, 0.66))), 0.0);
    float3 lit = input.Colour * (sky + 0.3 * sun);
    lit *= 1.0 - 0.78 * Night;
    return float4(lerp(lit, FadeTo, Faded), 1.0);
}
