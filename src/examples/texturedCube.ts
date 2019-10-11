import { mat4, vec3 } from 'gl-matrix';
import { createTextureFromImage } from '../helpers';
import { cubeVertexArray, cubeVertexSize, cubeUVOffset, cubePositionOffset } from '../cube';
import glslangModule from '../glslang';

export const title = 'Textured Cube';
export const description = 'This example shows how to bind and sample textures.';

export async function init(canvas: HTMLCanvasElement) {
  const vertexShaderGLSL = `#version 450
  layout(set = 0, binding = 0) uniform Uniforms {
    mat4 modelViewProjectionMatrix;
  } uniforms;

  layout(location = 0) in vec4 position;
  layout(location = 1) in vec2 uv;

  layout(location = 0) out vec2 fragUV;
  layout(location = 1) out vec4 fragPosition;

  void main() {
    fragPosition = 0.5 * (position + vec4(1.0));
    gl_Position = uniforms.modelViewProjectionMatrix * position;
    fragUV = uv;
  }
  `;

  const fragmentShaderGLSL = `#version 450
  layout(set = 0, binding = 1) uniform sampler mySampler;
  layout(set = 0, binding = 2) uniform texture2D myTexture;

  layout(location = 0) in vec2 fragUV;
  layout(location = 1) in vec4 fragPosition;
  layout(location = 0) out vec4 outColor;

  void main() {
    outColor =  texture(sampler2D(myTexture, mySampler), fragUV) * fragPosition;
  }
  `;

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const glslang = await glslangModule();

  const aspect = Math.abs(canvas.width / canvas.height);
  let projectionMatrix = mat4.create();
  mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 100.0);

  const context = canvas.getContext('gpupresent');

  // @ts-ignore:
  const swapChain = context.configureSwapChain({
    device,
    format: "bgra8unorm",
  });

  const verticesBuffer = device.createBuffer({
    size: cubeVertexArray.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  verticesBuffer.setSubData(0, cubeVertexArray);

  const bindGroupLayout = device.createBindGroupLayout({
    bindings: [{
      // Transform
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      type: "uniform-buffer"
    }, {
      // Sampler
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      type: "sampler"
    }, {
      // Texture view
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      type: "sampled-texture"
    }]
  });

  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,

    vertexStage: {
      module: device.createShaderModule({
        code: glslang.compileGLSL(vertexShaderGLSL, "vertex"),
      }),
      entryPoint: "main"
    },
    fragmentStage: {
      module: device.createShaderModule({
        code: glslang.compileGLSL(fragmentShaderGLSL, "fragment"),
      }),
      entryPoint: "main"
    },

    primitiveTopology: "triangle-list",
    depthStencilState: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus-stencil8",
    },
    vertexInput: {
      vertexBuffers: [{
        stride: cubeVertexSize,
        attributeSet: [{
          // position
          shaderLocation: 0,
          offset: cubePositionOffset,
          format: "float4"
        }, {
          // uv
          shaderLocation: 1,
          offset: cubeUVOffset,
          format: "float2"
        }]
      }],
    },

    rasterizationState: {
      cullMode: 'back',
    },

    colorStates: [{
      format: "bgra8unorm",
    }],
  });

  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height, depth: 1 },
    format: "depth24plus-stencil8",
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
  });

  const renderPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: [{
      attachment: undefined, // Assigned later

      loadValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
    }],
    depthStencilAttachment: {
      attachment: depthTexture.createView(),

      depthLoadValue: 1.0,
      depthStoreOp: "store",
      stencilLoadValue: 0,
      stencilStoreOp: "store",
    }
  };

  const uniformBufferSize = 4 * 16; // 4x4 matrix
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const cubeTexture = await createTextureFromImage(device, 'assets/img/Di-3d.png', GPUTextureUsage.SAMPLED);

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const uniformBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    bindings: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
      },
    }, {
      binding: 1,
      resource: sampler,
    }, {
      binding: 2,
      resource: cubeTexture.createView(),
    }],
  });

  function getTransformationMatrix() {
    let viewMatrix = mat4.create();
    mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -4));
    let now = Date.now() / 1000;
    mat4.rotate(viewMatrix, viewMatrix, 1, vec3.fromValues(Math.sin(now), Math.cos(now), 0));

    let modelViewProjectionMatrix = mat4.create();
    mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

    return modelViewProjectionMatrix;
  }

  return function frame() {
    renderPassDescriptor.colorAttachments[0].attachment = swapChain.getCurrentTexture().createView();

    const commandEncoder = device.createCommandEncoder({});
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.setVertexBuffer(0, verticesBuffer);
    passEncoder.draw(36, 1, 0, 0);
    passEncoder.endPass();

    device.getQueue().submit([commandEncoder.finish()]);

    uniformBuffer.setSubData(0, getTransformationMatrix());
  }

}