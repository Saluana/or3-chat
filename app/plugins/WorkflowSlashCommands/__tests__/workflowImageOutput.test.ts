import { describe, expect, it } from 'vitest';
import { workflowNeedsForegroundImagePersistence } from '../workflowImageOutput';

function model(id: string, outputModalities: string[]) {
    return {
        id,
        name: id,
        architecture: {
            input_modalities: ['text'],
            output_modalities: outputModalities,
        },
    } as any;
}

function workflowWithModel(modelId: string) {
    return {
        nodes: [
            {
                id: 'agent-1',
                type: 'agent',
                data: { model: modelId },
            },
        ],
        edges: [],
    };
}

describe('workflow image-output routing', () => {
    it('keeps cataloged image-output models on the foreground path', () => {
        expect(
            workflowNeedsForegroundImagePersistence(
                workflowWithModel('image-model'),
                [model('image-model', ['text', 'image'])]
            )
        ).toBe(true);
    });

    it('allows cataloged text-only models to use background execution', () => {
        expect(
            workflowNeedsForegroundImagePersistence(
                workflowWithModel('text-model'),
                [model('text-model', ['text'])]
            )
        ).toBe(false);
    });

    it('checks explicit parallel branch models without requiring a parent model', () => {
        expect(
            workflowNeedsForegroundImagePersistence(
                {
                    nodes: [
                        {
                            id: 'parallel-1',
                            type: 'parallel',
                            data: {
                                branches: [
                                    { id: 'branch-1', model: 'image-model' },
                                ],
                            },
                        },
                    ],
                    edges: [],
                },
                [model('image-model', ['text', 'image'])]
            )
        ).toBe(true);
    });

    it('keeps unknown models foreground until catalog capabilities are known', () => {
        expect(
            workflowNeedsForegroundImagePersistence(
                workflowWithModel('uncached-model'),
                []
            )
        ).toBe(true);
    });
});
