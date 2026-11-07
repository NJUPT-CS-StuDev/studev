// The buildings as the GPU draws them, inside MapLibre's own frame so they share its depth buffer.
// The web's src/campus/map/models.ts draws the same 12-byte vertices with the same light.
#include <GLES3/gl3.h>
#include <android/log.h>
#include <jni.h>

#include <array>
#include <atomic>
#include <cmath>
#include <memory>

// The part of MapLibre Native 13.7's custom layer contract this needs: the virtual table and the
// camera parameters, from include/mln/style/layers/custom_layer_host.hpp. Bump with the dependency.
namespace mln {
namespace gfx { class Context; }
namespace style {
struct CustomLayerInitParameters { virtual ~CustomLayerInitParameters() = default; };
struct CustomLayerRenderParameters {
    double width, height, latitude, longitude, zoom, bearing, pitch, fieldOfView;
    std::array<double, 16> projectionMatrix;
    std::array<double, 16> nearClippedProjectionMatrix;
};
class CustomLayerHost {
public:
    virtual ~CustomLayerHost() = default;
    virtual void initialize(const CustomLayerInitParameters&) = 0;
    virtual void preRender(const gfx::Context&, const CustomLayerRenderParameters&) {}
    virtual void render(const CustomLayerRenderParameters&) = 0;
    virtual void contextLost() = 0;
    virtual void deinitialize() = 0;
};
} // namespace style
} // namespace mln

namespace {
const char* VERTEX = R"(#version 300 es
uniform mat4 u_matrix;
uniform float u_flatten;
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_colour;
out vec3 v_normal;
out vec3 v_colour;
void main() {
    v_normal = a_normal;
    v_colour = a_colour;
    gl_Position = u_matrix * vec4(a_pos.xy, a_pos.z * u_flatten, 1.0);
})";
const char* FRAGMENT = R"(#version 300 es
precision mediump float;
uniform float u_night;
uniform float u_faded;
uniform vec3 u_fade_to;
in vec3 v_normal;
in vec3 v_colour;
out vec4 colour;
void main() {
    vec3 n = normalize(v_normal);
    float sky = .62 + .38 * max(n.z, 0.);
    float sun = max(dot(n, normalize(vec3(.45, -.6, .66))), 0.);
    vec3 lit = v_colour * (sky + .3 * sun);
    lit *= 1. - .78 * u_night;
    colour = vec4(mix(lit, u_fade_to, u_faded), 1.);
})";

struct Look {
    std::atomic<int> hiddenFirst{-1}, hiddenCount{0};
    std::atomic<float> flatten{1}, night{0}, faded{0}, r{0}, g{0}, b{0};
} look;

GLuint compile(GLenum type, const char* source) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[512];
        glGetShaderInfoLog(shader, sizeof log, nullptr, log);
        __android_log_print(ANDROID_LOG_ERROR, "campusmodels", "%s", log);
    }
    return shader;
}

class Models final : public mln::style::CustomLayerHost {
public:
    Models(const void* data, long bytes, double lon, double lat, double scale): data_(data), bytes_(bytes), scale_(scale) {
        const double pi = 3.14159265358979323846;
        const double rad = lat * pi / 180;
        x_ = (lon + 180) / 360;
        y_ = (1 - std::log(std::tan(pi / 4 + rad / 2)) / pi) / 2;
        unit_ = scale / (40075016.68557849 * std::cos(rad));
    }
    void initialize(const mln::style::CustomLayerInitParameters&) override {
        program_ = glCreateProgram();
        glAttachShader(program_, compile(GL_VERTEX_SHADER, VERTEX));
        glAttachShader(program_, compile(GL_FRAGMENT_SHADER, FRAGMENT));
        glLinkProgram(program_);
        matrix_ = glGetUniformLocation(program_, "u_matrix");
        flatten_ = glGetUniformLocation(program_, "u_flatten");
        night_ = glGetUniformLocation(program_, "u_night");
        faded_ = glGetUniformLocation(program_, "u_faded");
        fadeTo_ = glGetUniformLocation(program_, "u_fade_to");
        glGenVertexArrays(1, &vao_);
        glBindVertexArray(vao_);
        glGenBuffers(1, &buffer_);
        glBindBuffer(GL_ARRAY_BUFFER, buffer_);
        glBufferData(GL_ARRAY_BUFFER, bytes_, data_, GL_STATIC_DRAW);
        attribute("a_pos", 3, GL_SHORT, GL_FALSE, 0);
        attribute("a_normal", 3, GL_BYTE, GL_TRUE, 6);
        attribute("a_colour", 3, GL_UNSIGNED_BYTE, GL_TRUE, 9);
        glBindVertexArray(0);
    }
    void render(const mln::style::CustomLayerRenderParameters& camera) override {
        // World pixels at this zoom, y down; MapLibre's matrix already takes z in metres.
        const double world = 512 * std::pow(2.0, camera.zoom);
        const double u = unit_ * world;
        const std::array<double, 16> model{u, 0, 0, 0, 0, -u, 0, 0, 0, 0, scale_, 0, x_ * world, y_ * world, 0, 1};
        GLfloat matrix[16];
        for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++) {
            double sum = 0;
            for (int k = 0; k < 4; k++) sum += camera.projectionMatrix[k * 4 + r] * model[c * 4 + k];
            matrix[c * 4 + r] = static_cast<GLfloat>(sum);
        }
        glUseProgram(program_);
        glBindVertexArray(vao_);
        glEnable(GL_DEPTH_TEST);
        glDepthMask(GL_TRUE);
        glDepthFunc(GL_LEQUAL);
        glDisable(GL_CULL_FACE);
        glDisable(GL_STENCIL_TEST);
        glDisable(GL_BLEND);
        glUniformMatrix4fv(matrix_, 1, GL_FALSE, matrix);
        glUniform1f(flatten_, look.flatten);
        glUniform1f(night_, look.night);
        glUniform1f(faded_, look.faded);
        glUniform3f(fadeTo_, look.r, look.g, look.b);
        const GLsizei count = static_cast<GLsizei>(bytes_ / 12);
        const int first = look.hiddenFirst, skipped = look.hiddenCount;
        if (first >= 0) {
            glDrawArrays(GL_TRIANGLES, 0, first);
            glDrawArrays(GL_TRIANGLES, first + skipped, count - first - skipped);
        } else glDrawArrays(GL_TRIANGLES, 0, count);
        glBindVertexArray(0);
        glUseProgram(0);
    }
    void contextLost() override { program_ = vao_ = buffer_ = 0; }
    void deinitialize() override {
        if (program_) {
            glDeleteBuffers(1, &buffer_);
            glDeleteVertexArrays(1, &vao_);
            glDeleteProgram(program_);
        }
    }

private:
    void attribute(const char* name, GLint size, GLenum type, GLboolean normalized, intptr_t offset) {
        const GLint at = glGetAttribLocation(program_, name);
        glEnableVertexAttribArray(at);
        glVertexAttribPointer(at, size, type, normalized, 12, reinterpret_cast<const void*>(offset));
    }
    const void* data_;
    long bytes_;
    double scale_, x_ = 0, y_ = 0, unit_ = 0;
    GLuint program_ = 0, vao_ = 0, buffer_ = 0;
    GLint matrix_ = 0, flatten_ = 0, night_ = 0, faded_ = 0, fadeTo_ = 0;
};
} // namespace

extern "C" JNIEXPORT jlong JNICALL Java_top_hicancan_studev_map_Models_host(JNIEnv* env, jobject, jobject buffer, jdouble lon, jdouble lat, jdouble scale) {
    // The buffer stays alive with the process: a lost graphics context uploads it again.
    env->NewGlobalRef(buffer);
    return reinterpret_cast<jlong>(static_cast<mln::style::CustomLayerHost*>(new Models(env->GetDirectBufferAddress(buffer), env->GetDirectBufferCapacity(buffer), lon, lat, scale)));
}
extern "C" JNIEXPORT void JNICALL Java_top_hicancan_studev_map_Models_look(JNIEnv*, jobject, jint first, jint count, jfloat flatten, jfloat night, jfloat faded, jfloat r, jfloat g, jfloat b) {
    look.hiddenFirst = first; look.hiddenCount = count; look.flatten = flatten; look.night = night; look.faded = faded; look.r = r; look.g = g; look.b = b;
}
