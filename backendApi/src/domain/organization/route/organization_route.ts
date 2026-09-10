import { Router } from 'express';
import { OrganizationController } from '../controller/organization_controller';
import { organizationMiddleware } from '../middleware/organization_middleware';

const router = Router();
const controller = new OrganizationController();

router.post('/', organizationMiddleware.validateCreate, controller.createOrganization);
router.get('/', controller.listOrganizations);
router.get('/departments', controller.listDepartments);
router.get('/:id', controller.getOrganization);
router.put('/:id', organizationMiddleware.validateUpdate, controller.updateOrganization);
router.delete('/:id', controller.deleteOrganization);

export default router;
